/**
 * 添加 CORS 头
 * @param response 响应
 * @returns 添加 CORS 头后的响应
 */
export function cors(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set(
        'Access-Control-Allow-Headers',
        'Accept, Authorization, Content-Type, Docker-Distribution-Api-Version, If-None-Match, Range'
    );
    headers.set(
        'Access-Control-Expose-Headers',
        'Docker-Content-Digest, Docker-Distribution-Api-Version, ETag, Location, Www-Authenticate'
    );
    return new Response(response.body, {
        status: response.status,
        headers
    });
}
