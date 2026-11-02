import type { RegistryConfig, RegistryType } from '../types';
import { registryConfigs } from '../constants/registry';
import { DockerProxy } from './proxys/docker.proxy';

export class RegistryProxy {
    private dockerProxy: DockerProxy;
    private url: URL;
    constructor(request: Request) {
        this.url = new URL(request.url);
        this.dockerProxy = new DockerProxy(request);
    }

    /**
     * 匹配请求
     * @returns 响应
     */
    public async match(): Promise<Response> {
        const upstream = this.getUpstreamConfig();
        return this.dockerProxy.forward(upstream.registry, upstream.key);
    }

    /**
     * 获取上游地址
     * @returns 上游地址
     */
    private getUpstreamConfig(): { key: RegistryType; registry: string } {
        const keys = Object.keys(registryConfigs) as (keyof RegistryConfig)[];
        const key = keys.find(key => this.url.hostname === key || this.url.hostname.startsWith(`${key}.`));
        if (key) {
            return {
                key,
                registry: registryConfigs[key]
            };
        }
        return {
            key: 'docker',
            registry: registryConfigs.docker
        };
    }
}
