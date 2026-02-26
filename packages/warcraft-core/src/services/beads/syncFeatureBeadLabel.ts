import type { BeadsModeProvider } from '../../types.js';
import { getFeatureJsonPath } from '../../utils/paths.js';
import { readJson } from '../../utils/fs.js';

interface FeatureBeadLabelClient {
  addLabel(beadId: string, label: string): void;
}

interface SyncFeatureBeadLabelOptions {
  projectRoot: string;
  featureName: string;
  label: string;
  context: string;
  warningPrefix: string;
  beadsModeProvider: BeadsModeProvider;
  client: FeatureBeadLabelClient;
}

export function syncFeatureBeadLabel(options: SyncFeatureBeadLabelOptions): void {
  const beadsMode = options.beadsModeProvider.getBeadsMode();

  if (beadsMode === 'off') {
    return;
  }

  const feature = readJson<{ epicBeadId?: string }>(
    getFeatureJsonPath(options.projectRoot, options.featureName, beadsMode),
  );
  const epicBeadId = feature?.epicBeadId;
  if (!epicBeadId) {
    return;
  }

  try {
    options.client.addLabel(epicBeadId, options.label);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[warcraft] Failed to sync ${options.warningPrefix} during ${options.context} for feature '${options.featureName}' (${epicBeadId}): ${reason}`,
    );
  }
}
