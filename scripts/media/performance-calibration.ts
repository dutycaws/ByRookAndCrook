import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateCalibrationReports, parseCalibrationReport } from './performance-policy';

function directoryFromArguments(arguments_: string[]) {
  const index = arguments_.indexOf('--directory');
  if (index === -1 || !arguments_[index + 1] || arguments_.length !== 2) {
    throw new Error('Usage: media:perf:calibration --directory <downloaded-report-directory>');
  }
  return resolve(arguments_[index + 1]!);
}

type RejectedReport = { file: string; reason: string };

/**
 * GitHub downloads each artifact into its own directory. Traverse only real
 * directories and files; never follow symlinks supplied by an artifact.
 */
async function discoverReportFiles(root: string, relative = ''): Promise<{ files: string[]; rejected: RejectedReport[] }> {
  const entries = await readdir(resolve(root, relative), { withFileTypes: true });
  const files: string[] = [];
  const rejected: RejectedReport[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const nested = await discoverReportFiles(root, path);
      files.push(...nested.files);
      rejected.push(...nested.rejected);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path);
    } else if (entry.isSymbolicLink()) {
      rejected.push({ file: path, reason: 'symbolic links are not followed' });
    }
  }
  return { files, rejected };
}

export async function readCalibrationReports(directory: string) {
  const discovered = await discoverReportFiles(directory);
  const files = discovered.files.sort();
  const reports = [];
  const rejected: RejectedReport[] = [...discovered.rejected].sort((left, right) => left.file.localeCompare(right.file));
  const seenRuns = new Set<string>();
  for (const file of files) {
    try {
      const report = parseCalibrationReport(JSON.parse(await readFile(resolve(directory, file), 'utf8')));
      const key = `${report.gitRevision}:${report.generatedAt}`;
      if (seenRuns.has(key)) {
        rejected.push({ file, reason: `duplicate report run ${key}` });
      } else {
        seenRuns.add(key);
        reports.push(report);
      }
    } catch (error) {
      rejected.push({ file, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reports, rejected: rejected.sort((left, right) => left.file.localeCompare(right.file)) };
}

export async function runCalibration(directory: string) {
  const { reports, rejected } = await readCalibrationReports(directory);
  const result = evaluateCalibrationReports(reports);
  console.info(`[media:perf:calibration] ${result.validRuns}/${result.requiredRuns} unique valid report-mode runs.`);
  for (const ignored of rejected) console.warn(`[media:perf:calibration] Ignored ${ignored.file}: ${ignored.reason}`);
  if (result.validRuns >= result.requiredRuns) {
    for (const metric of result.metrics) {
      console.info(`[media:perf:calibration] ${metric.route} ${metric.metric}: p75 ${metric.p75} (budget ${metric.budget}) ${metric.pass ? 'PASS' : 'FAIL'}`);
    }
  }
  if (!result.passed) {
    const reason = result.validRuns < result.requiredRuns
      ? `requires ${result.requiredRuns} unique valid reports`
      : 'one or more route p75 values exceed the absolute budget';
    throw new Error(`Media performance calibration is not ready to enforce: ${reason}.`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void runCalibration(directoryFromArguments(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
