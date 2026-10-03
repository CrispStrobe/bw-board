/** Diagnostic boundaries only; sampled wall times are not ordinary timings. */
export function inspectorPost (session, method, params = {}) {
    return new Promise((resolve, reject) => {
        session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
    });
}

/** The body must be synchronous. Stop sampling before capture/observation/logging. */
export async function withWindowCpuProfile (session, body, capture) {
    await inspectorPost(session, 'Profiler.start');
    let result, failure;
    try {
        result = body();
        if (typeof result?.then === 'function') throw Error('Profile window body must be synchronous');
    } catch (error) { failure = error; }
    try {
        const {profile} = await inspectorPost(session, 'Profiler.stop');
        if (!profile) throw Error('Profiler.stop returned no profile');
        await capture(profile); // Preserve original data before strict attribution.
    } catch (error) {
        if (failure) throw new AggregateError([failure, error], 'Window and profile capture failed');
        throw error;
    }
    if (failure) throw failure;
    return result;
}
