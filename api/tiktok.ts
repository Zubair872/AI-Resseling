// Purpose: TikTok Content Posting API client (official API). Needs a TikTok developer app approved for the Content Posting API
// and a user access token with video.publish / video.upload scope. Unaudited apps can only post privately (SELF_ONLY).
// Not verified against a live TikTok account. A job counts as sent only when TikTok returns a publish_id.
export class TikTokError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?: number) {
    super(message)
    this.name = 'TikTokError'
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
const BASE = 'https://open.tiktokapis.com'

export class TikTokClient {
  constructor(private readonly accessToken: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  private async call<T>(path: string, body?: unknown): Promise<T> {
    let response
    try {
      response = await this.fetchImpl(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body ?? {}) })
    } catch {
      throw new TikTokError('Could not reach TikTok. Check the connection and try again.', true)
    }
    const data = (await response.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null
    if (!response.ok || (data?.error?.code && data.error.code !== 'ok')) throw new TikTokError(data?.error?.message ?? `TikTok returned HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status)
    if (!data?.data) throw new TikTokError('TikTok returned an unreadable response', true)
    return data.data
  }

  // Confirms the token works and tells which privacy levels this account may use.
  queryCreatorInfo() {
    return this.call<{ creator_username?: string; privacy_level_options?: string[]; max_video_post_duration_sec?: number }>('/v2/post/publish/creator_info/query/')
  }

  // Photo post from public image URLs (the URL domain must be verified in the TikTok developer portal).
  async publishPhotos(input: { title: string; description: string; imageUrls: string[]; privacyLevel: string }) {
    if (input.imageUrls.length === 0) throw new TikTokError('TikTok photo posts need at least one image URL')
    const data = await this.call<{ publish_id?: string }>('/v2/post/publish/content/init/', {
      media_type: 'PHOTO', post_mode: 'DIRECT_POST',
      post_info: { title: input.title.slice(0, 90), description: input.description.slice(0, 4000), privacy_level: input.privacyLevel, disable_comment: false },
      source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: input.imageUrls.slice(0, 35) },
    })
    if (!data.publish_id) throw new TikTokError('TikTok did not return a publish id')
    return { publishId: data.publish_id }
  }

  async fetchStatus(publishId: string) {
    const data = await this.call<{ status?: string; fail_reason?: string }>('/v2/post/publish/status/fetch/', { publish_id: publishId })
    return { status: data.status ?? 'UNKNOWN', failReason: data.fail_reason }
  }
}
