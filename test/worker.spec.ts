import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { RegistryProxy } from '../src/core';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const handle = (url: string, init?: RequestInit<IncomingRequestCfProperties>) =>
    worker.fetch!(new IncomingRequest(url, init), env, createExecutionContext());

afterEach(() => vi.unstubAllGlobals());

describe('registry proxy', () => {
    it('rejects an untrusted token realm without fetching it', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const response = await handle(
            'https://ghcr.example/v2/auth?registry=ghcr&realm=https%3A%2F%2Fevil.example%2Ftoken&service=ghcr.io&scope=repository%3Aorg%2Fimage%3Apull',
            
        );
        expect(response.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('forwards upload method, query, body, and authorization', async () => {
        let upstreamRequest: Request | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                upstreamRequest = new Request(input);
                return new Response('accepted', { status: 202 });
            })
        );
        const response = await handle('https://ghcr.example/v2/org/image/blobs/uploads/?digest=sha256%3Aabc', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer test' },
            body: 'layer-data'
        });
        expect(response.status).toBe(202);
        expect(upstreamRequest?.url).toBe('https://ghcr.io/v2/org/image/blobs/uploads/?digest=sha256%3Aabc');
        expect(upstreamRequest?.method).toBe('PUT');
        expect(new TextDecoder().decode(await upstreamRequest?.arrayBuffer())).toBe('layer-data');
        expect(upstreamRequest?.headers.get('authorization')).toBe('Bearer test');
    });

    it('preserves HEAD responses and adds CORS headers', async () => {
        let upstreamRequest: Request | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                upstreamRequest = new Request(input);
                return new Response(null, { status: 404 });
            })
        );
        const response = await handle('https://ghcr.example/v2/org/image/manifests/missing', { method: 'HEAD' });
        expect(upstreamRequest?.method).toBe('HEAD');
        expect(response.status).toBe(404);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('rewrites auth challenges and retries a manifest request with the returned token', async () => {
        const manifestCalls: Request[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const request = new Request(input);
                manifestCalls.push(request);
                if (manifestCalls.length === 1) {
                    return new Response(null, {
                        status: 401,
                        headers: {
                            'www-authenticate':
                                'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:ithtelab/workbuddy-manager:pull"'
                        }
                    });
                }
                if (request.url.startsWith('https://ghcr.io/token')) {
                    expect(request.headers.get('authorization')).toBe('Bearer client-credentials');
                    return new Response('{"token":"ghcr-token"}');
                }
                return new Response(null, { status: 200 });
            })
        );
        const challenge = await handle('https://ghcr.example/v2/ithtelab/workbuddy-manager/manifests/1.0.71', {
            method: 'HEAD',
            headers: { Authorization: 'Bearer client-credentials' }
        });
        expect(challenge.status).toBe(401);
        const authenticate = challenge.headers.get('www-authenticate')!;
        expect(authenticate).toContain('realm="https://ghcr.example/v2/auth?');
        expect(authenticate).toContain('scope="repository:ithtelab/workbuddy-manager:pull"');

        const realm = authenticate.match(/realm="([^"]+)"/)![1];
        await handle(realm, { headers: { Authorization: 'Bearer client-credentials' } });
        const retry = await handle('https://ghcr.example/v2/ithtelab/workbuddy-manager/manifests/1.0.71', {
            method: 'HEAD',
            headers: { Authorization: 'Bearer ghcr-token' }
        });
        expect(retry.status).toBe(200);
        expect(manifestCalls).toHaveLength(3);
    });

    it('handles CORS preflight requests', async () => {
        const response = await handle('https://ghcr.example/v2/', { method: 'OPTIONS' });
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('preserves upstream token query parameters and forwards scope', async () => {
        const authCalls: Request[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const request = new Request(input);
                authCalls.push(request);
                if (authCalls.length === 1) {
                    return new Response(null, {
                        status: 401,
                        headers: {
                            'www-authenticate':
                                'Bearer realm="https://ghcr.io/token?audience=x",service="ghcr.io",scope="repository:org/image:pull"'
                        }
                    });
                }
                return new Response('{"token":"ok"}');
            })
        );
        const challenge = await handle('https://ghcr.example/v2/');
        const realm = challenge.headers.get('www-authenticate')!.match(/realm="([^"]+)"/)![1];
        expect((await handle(realm)).status).toBe(200);
        expect(authCalls[1].url).toBe('https://ghcr.io/token?audience=x&service=ghcr.io&scope=repository%3Aorg%2Fimage%3Apull');
    });

    it('allows token services that do not require scope', async () => {
        const authCalls: Request[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                authCalls.push(new Request(input));
                if (authCalls.length === 1) {
                    return new Response(null, {
                        status: 401,
                        headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' }
                    });
                }
                return new Response('{}');
            })
        );
        const challenge = await handle('https://ghcr.example/v2/');
        const realm = challenge.headers.get('www-authenticate')!.match(/realm="([^"]+)"/)![1];
        await handle(realm);
        expect(authCalls[1].url).toBe('https://ghcr.io/token?service=ghcr.io');
    });

    it('does not select a registry from a hostname prefix', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async input => new Response(new URL(input as string).hostname))
        );
        const proxy = new RegistryProxy(new Request('https://ghcrspoof.example/v2/'));
        expect(await (await proxy.match()).text()).toBe('registry-1.docker.io');
    });
});
