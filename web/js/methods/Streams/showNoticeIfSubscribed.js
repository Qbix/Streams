Q.exports(function(priv){
    /**
     * Use this to check whether user subscribed to stream
     * and also whether subscribed to message type (from streams_subscription_rule)
     * @static
     * @method showNoticeIfSubscribed
     * @param {object} options
     * @param {string} options.publisherId
     * @param {string} options.streamName
     * @param {string} options.messageType
     * @param {string} [options.evenIfNotSubscribed=false] - If yes, show notice even if user not subscribed to stream.
     * @param {function} options.callback Function which called to show notice if all fine.
     */
    return function Streams_showNoticeIfSubscribed(options) {
        var publisherId = options.publisherId;
        var streamName = options.streamName;
        var messageType = options.messageType;
        var callback = options.callback;
        var evenIfNotSubscribed = options.evenIfNotSubscribed;

        Q.Streams.get.force(publisherId, streamName, function () {
            // return if user doesn't subscribed to stream
            if (!evenIfNotSubscribed && Q.getObject("participant.subscribed", this) !== 'yes') {
                return;
            }

            // filter.types lists message types the user IS subscribed to (same
            // semantics as Streams.Subscription.test). Skip the notice when the
            // filter is non-empty and this type is not among them.
            var streamsSubscribeRulesFilter = null;
            try {
                var filterRaw = Q.getObject("subscriptionRules.filter", this);
                streamsSubscribeRulesFilter = filterRaw
                    ? JSON.parse(filterRaw)
                    : null;
            } catch (e) {}
            var subscribedTypes = Q.getObject("types", streamsSubscribeRulesFilter) || [];
            if (subscribedTypes.length && !subscribedTypes.includes(messageType)) {
                return;
            }

            // if stream retained - don't show notice
            var ps = Q.Streams.key(publisherId, streamName);
            if (priv._retainedStreams[ps]) {
                return;
            }

            Q.handle(callback, this);
        }, {
            withParticipant: true,
            withSubscriptionRules: true
        });
    };
})