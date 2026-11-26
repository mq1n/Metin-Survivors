// Public surface of the meta layer. UI / app code imports from here; Sim only needs `MetaBonuses` (sim/run.ts).
//
//   const meta = await MetaService.open({ content, api });   // load / recover / create profile
//   meta.bindSettings(settings); meta.startAutoSync();        // optional wiring
//   const bonuses = meta.bonusesFor({ classId, doctrine, empire });   // → RunConfig.meta
//   const { summary, submit } = meta.settle(runResult);        // → results screen (+ leaderboard submission)

export { SAVE_VERSION, CLASS_IDS } from './types';
export type { SaveData, ClassSave, Bank, Unlocks, SaveStats, ZoneStats, ClassStats, BlacksmithStats, ProfileInfo, MetaContent, MetaRng } from './types';
export { SaveError, checksum } from './errors';
export type { SaveErrorCode } from './errors';
export { seededRng, systemRng, randomId } from './rng';
export { addStatMods, sumStatMods, scaleStatMods, isEmptyStatMods } from './statMods';
export { indexContent, doctrineId, doctrineIdsOf, doctrineKeyOf } from './content';
export type { ContentIndex, TreeIndex } from './content';
export { validateMetaContent, isKnownEffectKind } from './contentCheck';

export { MIGRATIONS, migrateSave, detectVersion } from './migrations';
export { newProfile, normalizeSave, emptyStats, emptyClassSave, DEFAULT_PROFILE_NAME, isDefaultProfileName, publicProfileName } from './save';
export { exportMsav, importMsav, msavFileName, downloadMsav, readMsavFile, MSAV_MAGIC } from './msav';
export type { ImportResult } from './msav';
export { MemoryStore, LocalStorageStore, IdbStore, SaveRepository, openBestStore } from './storage';
export type { KeyValueStore, LoadResult, SyncMeta } from './storage';

export * from './talents';
export * from './gear';
export * from './drops';
export * from './blacksmith';
export * from './unlocks';
export { computeMetaBonuses, computeMetaBonusDetail } from './bonuses';
export type { BonusContext, BonusBreakdown, BonusDetail } from './bonuses';
export { settleRun, talentXpFor, zoneXpMultiplier, runStatsOf, scoreOf, ZONE_XP_STEP } from './settle';
export type { SettlementSummary, SettleResult, TalentXpBreakdown } from './settle';

export { CloudSync, classifyCloudError, summarizeSave, hasProgress, sameProgress, formatTransferCode } from './cloud';
export type { CloudApi, CloudFailure, CloudFailureKind, SaveSummary, SyncConflict, SyncOutcome, TransferCodeResult, ClaimResult } from './cloud';
export { LeaderboardClient, RunSubmitter, buildRunSubmission, leaderboardKey } from './leaderboard';
export type { LeaderboardResult, SubmitOutcome, SubmitOptions, RunSubmitContext } from './leaderboard';

export { MetaService } from './service';
export type { MetaServiceOptions, SettingsPort, SettleOutcome, SettleOptions, CommitReason, TabChannel } from './service';
