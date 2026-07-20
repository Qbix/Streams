Q.exports(function(priv, Streams, Stream){
    /**
     * Check which of the given streams have been updated since the
     * client's last known messageCount. Uses the Streams/check socket
     * event, which is access-controlled and rate-limited on the server.
     *
     * If the socket is not connected, calls back with null (caller
     * should fall back to HTTP). This is advisory — the cache is
     * ephemeral and best-effort.
     *
     * @static
     * @method check
     * @param {Object} streams Map of {publisherId: {streamName: messageCount, ...}, ...}
     * @param {Function} callback receives (err, changed) where changed is
     *   {publisherId: {streamName: {messageCount, updatedTime}, ...}, ...}
     *   or null if socket is unavailable (fall back to HTTP)
     */
    return function _Stream_check (streams, callback) {
        if (!callback) return;
        if (!streams || Q.isEmpty(streams)) {
            return callback(null, {});
        }

        // Pick the node URL from the first stream in the set
        var publisherId, streamName;
        for (publisherId in streams) {
            for (streamName in streams[publisherId]) {
                break;
            }
            break;
        }
        var nodeUrl = Q.nodeUrl({
            publisherId: publisherId,
            streamName: streamName
        });
        var socket = Q.Socket.get('/Q', nodeUrl);
        if (!socket || !socket.connected) {
            return callback(null, null); // no socket — use HTTP
        }

        var ordinal = Q.latest('Streams.Stream.check');
        Q.Streams.socketRequest('Streams/check', streams, function (response) {
            if (!Q.latest('Streams.Stream.check', ordinal)) return;
            if (response && response.error) {
                return callback(response.error);
            }
            callback(null, response || {});
        });
    };
});