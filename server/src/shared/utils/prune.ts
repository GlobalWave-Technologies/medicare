// Maintenance deletes run in batches so each statement stays well inside the 3-second
// statement timeout even after a long gap between scheduled runs.
export const PRUNE_BATCH_SIZE = 1000
