import type { RegistryConfig, RegistryType } from '../../types';
import { REGISTRY_PATH_PATTERN, registryConfigs, REPOSITORY_REG } from '../../constants/registry';

const tokenHosts: Record<RegistryType, string[]> = {
    docker: ['auth.docker.io'],
    quay: ['quay.io'],
    gcr: ['gcr.io'],
    'k8s-gcr': ['k8s.gcr.io'],
    k8s: ['registry.k8s.io'],
    ghcr: ['ghcr.io'],
    cloudsmith: ['docker.cloudsmith.io', 'auth.cloudsmith.io'],
    mcr: ['mcr.microsoft.com']
};

export class DockerProxy {
    private request: Request;
    private url: URL;
    constructor(request: Request) {
        this.request = request;
        this.url = new URL(request.url);
    }

    public async forward(upstream: string, registry: RegistryType): Promise<Response> {
        if (this.url.pathname === '/v2/') {
            const registryUrl = new URL(`${upstream}/v2/`);
            const resp = await fetch(registryUrl.toString(), {
                method: this.request.method,
                headers: this.request.headers,
                redirect: 'manual'
            });

            if (resp.status === 401) {
                return this.rewriteAuthenticate(resp, registry);
            } else {
                return resp;
            }
        }

        if (this.url.pathname === '/v2/auth') {
            const realm = this.url.searchParams.get('realm');
            const registry = this.url.searchParams.get('registry') as RegistryType | null;
            const service = this.url.searchParams.get('service');
            const requestedScope = this.url.searchParams.get('scope');
            const scope = registry === 'docker' && requestedScope ? this.updateScope(requestedScope) : requestedScope;
            return this.getToken(realm, registry, service, scope);
        }

        if (registry === 'docker' && this.isRegistryPath(this.url.pathname)) {
            const redirectUrl = new URL(this.request.url);
            redirectUrl.pathname = redirectUrl.pathname.replace('/v2/', '/v2/library/');
            return Response.redirect(redirectUrl.href, 301);
        }

        const newUrl = new URL(upstream + this.url.pathname + this.url.search);
        const newReq = new Request(newUrl, this.request);

        const resp = await fetch(newReq);
        return resp.status === 401 ? this.rewriteAuthenticate(resp, registry) : resp;
    }

    private rewriteAuthenticate(resp: Response, registry: RegistryType): Response {
        const authenticate = this.parseAuthenticate(resp);
        if (!authenticate) return resp;
        const authUrl = new URL('/v2/auth', this.url.origin);
        authUrl.searchParams.set('registry', registry);
        authUrl.searchParams.set('realm', authenticate.realm);
        authUrl.searchParams.set('service', authenticate.service);
        if (authenticate.scope) authUrl.searchParams.set('scope', authenticate.scope);
        const headers = new Headers(resp.headers);
        headers.set(
            'Www-Authenticate',
            'Bearer realm="' +
                authUrl.href +
                '",service="' +
                authenticate.service +
                '"' +
                (authenticate.scope ? ',scope="' + authenticate.scope + '"' : '')
        );
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    }

    /**
     * 判断路径是否是 Registry 路径
     * @param path 路径
     * @returns 是否是 Registry 路径
     */
    private isRegistryPath(path: string): boolean {
        return REGISTRY_PATH_PATTERN.test(path);
    }

    /**
     * 更新 scope
     * @param scope scope
     * @returns 更新后的 scope
     */
    private updateScope(scope: string): string {
        const [, , namespace] = scope.match(REPOSITORY_REG) || [];
        if (!namespace) {
            return scope.replace(/repository:([^:]+)/, 'repository:library/$1');
        }
        return scope;
    }

    /**
     * 解析认证信息
     * @param resp 响应
     * @returns 认证信息
     */
    private parseAuthenticate(resp: Response): { realm: string; service: string; scope?: string } | null {
        const authenticate = resp.headers.get('www-authenticate');
        const values = authenticate?.match(/\b(realm|service|scope)="([^"]*)"/g);
        if (!values) return null;
        const params = Object.fromEntries(
            values.map(value => {
                const [, key, content] = value.match(/^(realm|service|scope)="([^"]*)"$/)!;
                return [key, content];
            })
        );
        if (!params.realm || !params.service) return null;
        return { realm: params.realm, service: params.service, scope: params.scope };
    }

    /**
     * 获取 token
     * @param realm 上游声明的认证地址
     * @param registry 当前选择的仓库
     * @param service 服务
     * @param scope scope
     * @returns 响应
     */
    private async getToken(
        realm: string | null,
        registry: RegistryType | null,
        service: string | null,
        scope: string | null
    ): Promise<Response> {
        if (!realm || !registry || !service || !Object.hasOwn(registryConfigs, registry)) {
            return new Response('Failed to get request token url', { status: 400 });
        }
        let tokenUrl: URL;
        try {
            tokenUrl = new URL(realm);
        } catch {
            return new Response('Invalid token realm', { status: 400 });
        }
        if (
            tokenUrl.protocol !== 'https:' ||
            tokenUrl.username ||
            tokenUrl.password ||
            (tokenUrl.port && tokenUrl.port !== '443') ||
            !tokenHosts[registry].includes(tokenUrl.hostname)
        ) {
            return new Response('Invalid token realm', { status: 400 });
        }
        tokenUrl.searchParams.set('service', service);
        if (scope) tokenUrl.searchParams.set('scope', scope);
        const headers = new Headers();
        const authorization = this.request.headers.get('Authorization');
        if (authorization) headers.set('Authorization', authorization);
        return fetch(tokenUrl, {
            headers,
            redirect: 'manual'
        });
    }
}
