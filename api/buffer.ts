// Purpose: Buffer GraphQL client (https://api.buffer.com, Bearer API key). Queries follow developers.buffer.com examples.
// Not verified against a live Buffer account in the authoring session: test the connection from the Integrations page.
export class BufferError extends Error {
  constructor(message: string, readonly retryable = false, readonly status?: number) {
    super(message)
    this.name = 'BufferError'
  }
}

export type BufferChannel = { id: string; name: string; displayName?: string | null; service: string; isQueuePaused?: boolean }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const gqlString = (value: string) => JSON.stringify(value)

export class BufferClient {
  constructor(private readonly apiKey: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike, private readonly endpoint = 'https://api.buffer.com') {}

  private async run<T>(query: string): Promise<T> {
    let response
    try {
      response = await this.fetchImpl(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ query }) })
    } catch {
      throw new BufferError('Could not reach Buffer. Check the connection and try again.', true)
    }
    if (response.status === 401 || response.status === 403) throw new BufferError('Buffer rejected the API key', false, response.status)
    if (response.status === 429) throw new BufferError('Buffer rate limit reached. Try again later.', true, 429)
    if (!response.ok) throw new BufferError(`Buffer returned HTTP ${response.status}`, response.status >= 500, response.status)
    const body = (await response.json().catch(() => null)) as { data?: T; errors?: { message?: string }[] } | null
    if (!body) throw new BufferError('Buffer returned an unreadable response', true)
    if (body.errors?.length) throw new BufferError(body.errors.map((error) => error.message ?? 'Unknown error').join('; '))
    if (!body.data) throw new BufferError('Buffer returned no data')
    return body.data
  }

  async listOrganizations() {
    const data = await this.run<{ account: { organizations: { id: string; name: string; ownerEmail?: string }[] } }>('query GetOrganizations { account { organizations { id name ownerEmail } } }')
    return data.account.organizations
  }

  async listChannels(organizationId: string) {
    const data = await this.run<{ channels: BufferChannel[] }>(`query GetChannels { channels(input: { organizationId: ${gqlString(organizationId)} }) { id name displayName service avatar isQueuePaused } }`)
    return data.channels
  }

  async createPost(input: { channelId: string; text: string; imageUrl?: string; dueAt?: string; service?: string }) {
    // A time that is now or already past ("Post now") cannot be a customScheduled time: Buffer refuses it. Send it right away instead.
    const future = input.dueAt ? new Date(input.dueAt).getTime() > Date.now() + 2 * 60_000 : false
    const timing = input.dueAt ? (future ? `schedulingType: automatic, mode: customScheduled, dueAt: ${gqlString(input.dueAt)}` : 'schedulingType: automatic, mode: shareNow') : 'schedulingType: automatic, mode: addToQueue'
    const assets = input.imageUrl ? `, assets: [{ image: { url: ${gqlString(input.imageUrl)} } }]` : ''
    // Buffer requires a post type for Facebook and Instagram (post, story or reel). Ordinary product posts are type "post".
    const service = (input.service ?? '').toLowerCase()
    const metadata = service === 'facebook' ? ', metadata: { facebook: { type: post } }' : service === 'instagram' ? ', metadata: { instagram: { type: post, shouldShareToFeed: true } }' : ''
    const data = await this.run<{ createPost: { post?: { id: string }; message?: string } }>(
      `mutation CreatePost { createPost(input: { text: ${gqlString(input.text)}, channelId: ${gqlString(input.channelId)}, ${timing}${assets}${metadata} }) { ... on PostActionSuccess { post { id text } } ... on MutationError { message } } }`,
    )
    if (data.createPost?.post?.id) return { id: data.createPost.post.id }
    throw new BufferError(data.createPost?.message ?? 'Buffer did not create the post')
  }
}
