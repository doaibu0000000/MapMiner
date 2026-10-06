// Penyimpanan job: memori + file JSON (persist antar restart)

import type { ScrapeJob } from "./types";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(import.meta.dir, "data");
const MAX_JOBS = 60;

export class JobStore {
  private jobs = new Map<string, ScrapeJob>();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      // HANYA file job (job_*.json) — file lain di data/ (mis. cache) bukan job.
      const files = readdirSync(DATA_DIR).filter((f) => f.startsWith("job_") && f.endsWith(".json"));
      for (const f of files) {
        try {
          const raw = readFileSync(join(DATA_DIR, f), "utf8");
          const job = JSON.parse(raw) as ScrapeJob;
          if (!job || typeof job.id !== "string" || !job.id) continue; // file rusak/bukan job → lewati
          if (!Array.isArray(job.places)) job.places = [];
          if (!job.stats) job.stats = { total: job.places.length } as ScrapeJob["stats"];
          if (!job.progress) job.progress = { phase: "-" } as ScrapeJob["progress"];
          // job yang terputus saat running → tandai gagal
          if (job.status === "running" || job.status === "queued") {
            job.status = "failed";
            job.error = "Service dimatikan saat job berjalan.";
            job.progress.phase = "Terputus";
          }
          // normalisasi field lead untuk job lama (migrasi data)
          for (const p of job.places ?? []) {
            if (!p.leadStatus) p.leadStatus = "baru";
            if (p.leadNote === undefined) p.leadNote = "";
            if (p.leadUpdatedAt === undefined) p.leadUpdatedAt = null;
            if ((p as any).email === undefined) { (p as any).email = ""; (p as any).emailStatus = "none"; }
            if ((p as any).instagram === undefined) {
              (p as any).instagram = "";
              (p as any).facebook = "";
              (p as any).tiktok = "";
              (p as any).socialStatus = "none";
            }
          }
          this.jobs.set(job.id, job);
        } catch {}
      }
    } catch {}
  }

  private persist(job: ScrapeJob) {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(join(DATA_DIR, `${job.id}.json`), JSON.stringify(job));
    } catch (e) {
      console.error("gagal persist job", e);
    }
  }

  save(job: ScrapeJob) {
    this.persist(job);
  }

  get(id: string): ScrapeJob | undefined {
    return this.jobs.get(id);
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  list(): ScrapeJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  create(job: ScrapeJob) {
    this.jobs.set(job.id, job);
    this.persist(job);
    this.prune();
  }

  delete(id: string): boolean {
    const existed = this.jobs.delete(id);
    if (existed) {
      try {
        const f = join(DATA_DIR, `${id}.json`);
        if (existsSync(f)) unlinkSync(f);
      } catch {}
    }
    return existed;
  }

  private prune() {
    const jobs = this.list();
    for (const job of jobs.slice(MAX_JOBS)) {
      this.delete(job.id);
    }
  }
}
