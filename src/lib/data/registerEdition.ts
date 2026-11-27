/**
 * Adds a new edition to src/lib/data/reportEditions.ts: one JSON import and one entry at the end
 * of EDITIONS. Used by scripts/data/buildMonthlyReport.ts --write, so the monthly job leaves a
 * branch that builds as it stands. Returns the source unchanged when the edition is already there.
 */
const IMPORT_RE = /^import e\d{6} from "@\/data\/reports\/\d{4}-\d{2}\.json";$/gm;
const EDITIONS_RE = /export const EDITIONS: ReportEdition\[\] = \[([^\]]*)\];/;

export function registerEdition(source: string, edition: string): string {
  if (!/^\d{4}-\d{2}$/.test(edition)) throw new Error(`Bad edition: ${edition}`);
  if (source.includes(`@/data/reports/${edition}.json`)) return source;

  const imports = [...source.matchAll(IMPORT_RE)];
  const edMatch = source.match(EDITIONS_RE);
  if (!imports.length || !edMatch) throw new Error("reportEditions.ts does not have the expected shape");

  const ident = `e${edition.replace("-", "")}`;
  const last = imports[imports.length - 1];
  const at = last.index! + last[0].length;
  let out = `${source.slice(0, at)}\nimport ${ident} from "@/data/reports/${edition}.json";${source.slice(at)}`;

  const entries = edMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  entries.push(`${ident} as unknown as ReportEdition`);
  out = out.replace(EDITIONS_RE, `export const EDITIONS: ReportEdition[] = [${entries.join(", ")}];`);
  return out;
}
