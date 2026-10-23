import type { Job } from '@sahamati/contracts';
import type { ApiClient } from './api';
import type { KV } from './kv';
import type { InFlightJob } from './reportService';

export const JOBS_KEY = 'jobs';
export const POLL_ALARM = 'sahamati-poll-jobs';
export const POLL_PERIOD_MIN = 0.5; // 30 s, the chrome.alarms minimum

export type JobMap = Record<string, InFlightJob>;

export async function listJobs(session: KV): Promise<JobMap> {
  return (await session.get<JobMap>(JOBS_KEY)) ?? {};
}

export async function putJob(session: KV, job: InFlightJob): Promise<void> {
  const jobs = await listJobs(session);
  jobs[job.job_id] = job;
  await session.set(JOBS_KEY, jobs);
}

export async function removeJob(session: KV, jobId: string): Promise<void> {
  const jobs = await listJobs(session);
  delete jobs[jobId];
  await session.set(JOBS_KEY, jobs);
}

export interface PollOutcome {
  finished: { job: InFlightJob; status: Job }[];
  remaining: number;
}

/** One polling pass over every in-flight job (used by the 30 s alarm). */
export async function pollJobsOnce(api: ApiClient, session: KV): Promise<PollOutcome> {
  const jobs = await listJobs(session);
  const finished: PollOutcome['finished'] = [];
  for (const job of Object.values(jobs)) {
    try {
      const status = await api.getJob(job.job_id);
      if (status.status === 'done' || status.status === 'error') {
        finished.push({ job, status });
        delete jobs[job.job_id];
      } else {
        jobs[job.job_id] = { ...job, stage: status.stage, progress: status.progress };
      }
    } catch {
      // Keep the job; drop it after an hour so a dead backend does not poll forever.
      if (Date.now() - job.startedAt > 60 * 60 * 1000) delete jobs[job.job_id];
    }
  }
  await session.set(JOBS_KEY, jobs);
  return { finished, remaining: Object.keys(jobs).length };
}
