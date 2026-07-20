import type {
  MatchAnalysis,
  MatchEnrichmentScope,
  PlayerEnrichmentProgress,
} from "@dodo/contracts";
import { MATCH_ANALYSIS_PROVIDER_REVISION } from "@dodo/contracts";
import { OpenDotaProviderError, type OpenDotaProvider } from "@dodo/dota-data";
import type { DataSource, DodoRepository, StoredMatch } from "@dodo/db";

import { toEnrichedMatchDetail, toStoredMatchAnalysis } from "./player-sync-service.js";
import {
  stratzEnrichmentIsEligible,
  type StratzMatchEnrichmentService,
} from "./stratz-match-enrichment-service.js";

const BATCH_SIZE = 20;

const analysisIsIncomplete = (analysis: MatchAnalysis): boolean => [
  analysis.playerTimelines.status,
  analysis.teamAdvantages.status,
  analysis.kills.status,
  analysis.damage.status,
  analysis.objectives.status,
  analysis.teamfights.status,
].some((status) => status !== "complete");

type MatchDetailProvider = Pick<OpenDotaProvider, "getMatchDetail">;

type MatchEnrichmentOrchestratorOptions = {
  repository: DodoRepository;
  provider: MatchDetailProvider;
  stratzService?: StratzMatchEnrichmentService;
  clock?: () => Date;
  onError?: (error: unknown) => void;
};

export type PlayerEnrichmentSnapshot = {
  progress: PlayerEnrichmentProgress;
  sources: DataSource[];
};

const inferOfficialVersion = (
  startTime: string,
  releases: Array<{ version: string; releasedAt: string }>,
): string | null =>
  releases.find((release) => Date.parse(release.releasedAt) <= Date.parse(startTime))?.version ??
  null;

const scopedMatches = (
  matches: StoredMatch[],
  scope: MatchEnrichmentScope,
): StoredMatch[] => scope === "recent" ? matches.slice(0, 20) : matches;

export class MatchEnrichmentOrchestrator {
  readonly #repository: DodoRepository;
  readonly #provider: MatchDetailProvider;
  readonly #stratzService: StratzMatchEnrichmentService | undefined;
  readonly #clock: () => Date;
  readonly #onError: (error: unknown) => void;
  readonly #matchInFlight = new Map<string, {
    execution: Promise<StoredMatch | undefined>;
    forceIncompleteAnalysis: boolean;
  }>();
  readonly #accountInFlight = new Map<string, Promise<void>>();

  constructor({
    repository,
    provider,
    stratzService,
    clock = () => new Date(),
    onError = () => console.error("Background match enrichment failed."),
  }: MatchEnrichmentOrchestratorOptions) {
    this.#repository = repository;
    this.#provider = provider;
    this.#stratzService = stratzService;
    this.#clock = clock;
    this.#onError = onError;
  }

  enrichMatch(matchId: string): Promise<StoredMatch | undefined> {
    return this.#requestMatchEnrichment(matchId, true);
  }

  #requestMatchEnrichment(
    matchId: string,
    forceIncompleteAnalysis: boolean,
  ): Promise<StoredMatch | undefined> {
    const existing = this.#matchInFlight.get(matchId);
    if (existing) {
      if (forceIncompleteAnalysis && !existing.forceIncompleteAnalysis) {
        return existing.execution.then(() =>
          this.#requestMatchEnrichment(matchId, true)
        );
      }
      return existing.execution;
    }
    const execution = this.#enrichMatch(matchId, forceIncompleteAnalysis).finally(() => {
      if (this.#matchInFlight.get(matchId)?.execution === execution) {
        this.#matchInFlight.delete(matchId);
      }
    });
    this.#matchInFlight.set(matchId, { execution, forceIncompleteAnalysis });
    return execution;
  }

  async getProgress(
    accountId: string,
    scope: MatchEnrichmentScope,
  ): Promise<PlayerEnrichmentSnapshot> {
    const matches = scopedMatches(await this.#repository.listPlayerMatches(accountId), scope);
    const analyses = await Promise.all(
      matches.map((match) => this.#repository.getMatchAnalysis(match.detail.id)),
    );
    const analysisByMatchId = new Map(
      analyses.flatMap((analysis) => analysis ? [[analysis.matchId, analysis] as const] : []),
    );
    const now = this.#clock();
    const counts = {
      detailReadyCount: 0,
      completeCount: 0,
      retryScheduledCount: 0,
      terminalPartialCount: 0,
      terminalFailedCount: 0,
      providerBlockedCount: 0,
      notRequestedCount: 0,
      retryEligibleCount: 0,
    };
    let updatedAt: string | null = null;
    const sources = new Set<DataSource>();
    for (const match of matches) {
      const analysis = analysisByMatchId.get(match.detail.id);
      sources.add(match.source);
      for (const source of match.detail.enrichmentSources) sources.add(source);
      if (
        match.detail.stratzEnrichment.status !== "not_requested" ||
        match.detail.stratzEnrichment.attemptCount > 0
      ) {
        sources.add("stratz");
      }
      if (updatedAt === null || match.importedAt > updatedAt) updatedAt = match.importedAt;
      if (analysis) {
        sources.add(analysis.analysis.source);
        if (analysis.importedAt > (updatedAt ?? "")) updatedAt = analysis.importedAt;
      }
      const state = match.detail.stratzEnrichment;
      if (state.lastAttemptAt && (updatedAt === null || state.lastAttemptAt > updatedAt)) {
        updatedAt = state.lastAttemptAt;
      }
      if (match.detail.detailStatus === "enriched") counts.detailReadyCount += 1;
      if (state.status === "complete") counts.completeCount += 1;
      else if (state.status === "retry_scheduled") counts.retryScheduledCount += 1;
      else if (state.status === "terminal_partial") counts.terminalPartialCount += 1;
      else if (state.status === "terminal_failed") counts.terminalFailedCount += 1;
      else if (state.status === "provider_blocked") counts.providerBlockedCount += 1;
      else counts.notRequestedCount += 1;
      if (
        match.detail.detailStatus === "summary" ||
        match.detail.parseStatus !== "parsed" ||
        analysis?.analysis.providerRevision !== MATCH_ANALYSIS_PROVIDER_REVISION ||
        stratzEnrichmentIsEligible(state, now)
      ) {
        counts.retryEligibleCount += 1;
      }
    }
    const key = `${accountId}:${scope}`;
    return {
      progress: {
        accountId,
        scope,
        running: this.#accountInFlight.has(key),
        batchSize: BATCH_SIZE,
        totalMatches: matches.length,
        ...counts,
        updatedAt,
      },
      sources: sources.size > 0 ? [...sources] : ["opendota"],
    };
  }

  async requestPlayerEnrichment(
    accountId: string,
    scope: MatchEnrichmentScope,
  ): Promise<PlayerEnrichmentSnapshot> {
    const key = `${accountId}:${scope}`;
    if (!this.#accountInFlight.has(key)) {
      const execution = this.#executePlayerBatch(accountId, scope)
        .catch((error: unknown) => {
          try {
            this.#onError(error);
          } catch {
            // Error reporting must not recreate an unhandled background rejection.
          }
        })
        .finally(() => {
          if (this.#accountInFlight.get(key) === execution) this.#accountInFlight.delete(key);
        });
      this.#accountInFlight.set(key, execution);
    }
    return this.getProgress(accountId, scope);
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      ...this.#accountInFlight.values(),
      ...[...this.#matchInFlight.values()].map(({ execution }) => execution),
    ]);
  }

  async #executePlayerBatch(accountId: string, scope: MatchEnrichmentScope): Promise<void> {
    const matches = scopedMatches(await this.#repository.listPlayerMatches(accountId), scope);
    const now = this.#clock();
    const analyses = await Promise.all(
      matches.map((match) => this.#repository.getMatchAnalysis(match.detail.id)),
    );
    const analysisByMatchId = new Map(
      analyses.flatMap((analysis) => analysis ? [[analysis.matchId, analysis] as const] : []),
    );
    const candidates = matches.filter((match) =>
      match.detail.detailStatus === "summary" ||
      match.detail.parseStatus !== "parsed" ||
      analysisByMatchId.get(match.detail.id)?.analysis.providerRevision !==
        MATCH_ANALYSIS_PROVIDER_REVISION ||
      stratzEnrichmentIsEligible(match.detail.stratzEnrichment, now)
    ).slice(0, BATCH_SIZE);
    for (const match of candidates) {
      try {
        await this.#requestMatchEnrichment(match.detail.id, false);
      } catch (error) {
        if (error instanceof OpenDotaProviderError) {
          if (
            error.code === "SOURCE_RATE_LIMITED" ||
            error.code === "SOURCE_UNAVAILABLE"
          ) {
            break;
          }
          continue;
        }
        throw error;
      }
    }
  }

  async #enrichMatch(
    matchId: string,
    forceIncompleteAnalysis: boolean,
  ): Promise<StoredMatch | undefined> {
    let stored = await this.#repository.getMatch(matchId);
    if (!stored) return undefined;
    const storedAnalysis = await this.#repository.getMatchAnalysis(matchId);
    const hasIncompleteAnalysis = storedAnalysis === undefined ||
      analysisIsIncomplete(storedAnalysis.analysis);
    if (
      stored.detail.detailStatus === "summary" ||
      stored.detail.parseStatus !== "parsed" ||
      storedAnalysis?.analysis.providerRevision !== MATCH_ANALYSIS_PROVIDER_REVISION ||
      (forceIncompleteAnalysis && hasIncompleteAnalysis)
    ) {
      const canonical = await this.#provider.getMatchDetail(matchId);
      const [items, patches] = await Promise.all([
        this.#repository.listItems(),
        this.#repository.listPatches(),
      ]);
      if (canonical.id !== matchId) throw new Error("Match detail provider returned a different match");
      const itemIdByName = new Map(items.map((item) => [item.name, item.id]));
      const detail = toEnrichedMatchDetail(
        canonical,
        itemIdByName,
        inferOfficialVersion(
          canonical.startTime,
          patches.map((patch) => ({ version: patch.name, releasedAt: patch.releasedAt })),
        ),
      );
      await this.#repository.upsertMatch({
        detail,
        importedAt: canonical.source.fetchedAt,
        source: "opendota",
        quality: canonical.quality,
      });
      const analysis = toStoredMatchAnalysis(canonical);
      if (analysis) await this.#repository.upsertMatchAnalysis(analysis);
      stored = await this.#repository.getMatch(matchId);
    }
    if (
      stored?.detail.detailStatus === "enriched" &&
      this.#stratzService &&
      stratzEnrichmentIsEligible(stored.detail.stratzEnrichment, this.#clock())
    ) {
      await this.#stratzService.enrichMatch(matchId);
    }
    return this.#repository.getMatch(matchId);
  }
}
