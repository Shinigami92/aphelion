/** Command-line flags: which stages run, and at what texture tier. */

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

const flag = (name: string): string | null => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) {
    return null;
  }
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1);
};

const only = flag('only');

const TIERS = ['max', 'high', 'lean'] as const;

const isTier = (value: string): value is (typeof TIERS)[number] =>
  (TIERS as ReadonlyArray<string>).includes(value);

const tierFlag = flag('tier') ?? 'max';

// An unrecognised --tier has always fallen through to the 'max' set.
export const tier = isTier(tierFlag) ? tierFlag : 'max';

export const skipUsgs = flag('skip-usgs') !== null;

export const doTextures = only === null || only === 'textures';

export const doData = only === null || only === 'data';

export const doRelief = only === null || only === 'relief';

export const manifestOnly = only === 'manifest';
