// Importing both stores here guarantees they exist (and have started loading) before anything
// waits on them with useStoresReady.
import '@/stores/preferences';
import '@/stores/trade-draft';

export { useStoresSettled as useStoresReady } from '@/stores/persist';
