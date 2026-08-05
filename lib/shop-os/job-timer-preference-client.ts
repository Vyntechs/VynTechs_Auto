export type JobTimerPreferenceEnvelope = {
  profileId: string
  enabled: boolean
}

export async function readJobTimerPreference(
  response: Response,
  expectedProfileId: string,
): Promise<JobTimerPreferenceEnvelope | null> {
  const body = (await response.json().catch(() => null)) as {
    preference?: unknown
  } | null
  const preference = body?.preference
  if (
    !preference ||
    typeof preference !== 'object' ||
    (preference as { profileId?: unknown }).profileId !== expectedProfileId ||
    typeof (preference as { enabled?: unknown }).enabled !== 'boolean'
  ) {
    return null
  }
  return preference as JobTimerPreferenceEnvelope
}
