import type { JobCheckpoint, Settings } from '../types'

const JOB_KEY = 'job'
const SETTINGS_KEY = 'settings'

export const DEFAULT_SETTINGS: Settings = {
  format: 'pdf',
  archiveName: 'WhatsApp-чат',
}

export async function loadJob(): Promise<JobCheckpoint | null> {
  const data = await chrome.storage.local.get(JOB_KEY)
  const job = data[JOB_KEY] as JobCheckpoint | undefined
  return job ?? null
}

export async function saveJob(job: JobCheckpoint): Promise<void> {
  await chrome.storage.local.set({ [JOB_KEY]: job })
}

export async function clearJob(): Promise<void> {
  await chrome.storage.local.remove(JOB_KEY)
}

export async function loadSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY)
  const settings = data[SETTINGS_KEY] as Settings | undefined
  return settings ?? DEFAULT_SETTINGS
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings })
}
