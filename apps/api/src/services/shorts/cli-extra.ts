/** CLI commands added by later phases (dry-run, ingest, sync, report). Returns null when `cmd` is unknown. */
export async function runCliExtra(
  _cmd: string | undefined,
  _ctx: { arg: (n: string) => string | undefined; flag: (n: string) => boolean; resolveOwner: () => Promise<string> },
): Promise<number | null> {
  return null;
}
