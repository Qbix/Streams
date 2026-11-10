/**
 * Streams/PeerMesh server-side signaling handler.
 *
 * Add to Streams.js inside the socket.io.of('/Q').on('connection', ...)
 * block, alongside the existing client.on('Streams/observe', ...) calls.
 *
 * Uses Streams.observers to find peers in the same stream rooms.
 * Optional geo-aware candidate selection via IP lookup (geoip-lite).
 *
 * Signaling protocol (all on the '/Q' namespace):
 *   Client → server:  'Streams/PeerMesh/signal'  { to, type, sdp?, candidate? }
 *   Server → client:  'Streams/PeerMesh/join'    { peers:[], serverKey? }
 *   Server → client:  'Streams/PeerMesh/offer'   { from, sdp }
 *   Server → client:  'Streams/PeerMesh/answer'  { from, sdp }
 *   Server → client:  'Streams/PeerMesh/ice'     { from, candidate }
 *   Server → client:  'Streams/PeerMesh/leave'   { peerId }
 */

var _geoip;
try { _geoip = require('geoip-lite'); } catch (e) { _geoip = null; }

var _peerMeshConfig = Q.Config.get(['Streams', 'peerMesh'], {});
var _maxCandidates  = _peerMeshConfig.maxCandidates || 6;
var _serverKey      = null; // set below if attestation is configured

// Load server signing key for envelope attestation (optional).
// Configure in config: Streams.peerMesh.serverKeyPath → path to ES256 private key PEM
var _serverKeyPath = _peerMeshConfig.serverKeyPath || null;
if (_serverKeyPath) {
	try {
		var _crypto = require('crypto');
		var _fs = require('fs');
		var _pem = _fs.readFileSync(_serverKeyPath);
		_serverKey = _crypto.createPrivateKey(_pem);
		// Export the public key so clients can verify
		var _pubDer = _serverKey.export({ type: 'spki', format: 'der' });
		// Raw uncompressed P-256 point is the last 65 bytes of the SPKI DER
		var _serverPublicKeyRaw = _pubDer.slice(-65);
	} catch (e) {
		Q.log('PeerMesh: could not load server key from ' + _serverKeyPath + ': ' + e.message);
	}
}

/**
 * Get the country code for a socket's IP address.
 * Returns null if geoip-lite is not installed or lookup fails.
 */
function _getCountry(client) {
	if (!_geoip) return null;
	var ip = client.handshake && client.handshake.address;
	if (!ip) return null;
	// Strip ::ffff: prefix from IPv4-mapped IPv6
	ip = ip.replace(/^::ffff:/, '');
	var geo = _geoip.lookup(ip);
	return geo ? geo.country : null;
}

/**
 * Find candidate peers for a client that just started observing a stream.
 * Returns up to maxCandidates peer IDs, preferring same-country peers.
 */
function _findCandidates(client, publisherId, streamName) {
	var observers = Q.getObject([publisherId, streamName], Streams.observers) || {};
	var clientCountry = _getCountry(client);
	var sameCountry = [];
	var other = [];

	for (var peerId in observers) {
		if (peerId === client.id) continue;
		var peer = observers[peerId];
		if (!peer || !peer.connected) continue;

		if (clientCountry && _getCountry(peer) === clientCountry) {
			sameCountry.push(peerId);
		} else {
			other.push(peerId);
		}
	}

	// Shuffle each group
	_shuffle(sameCountry);
	_shuffle(other);

	// Take half from same country, half from other
	var half = Math.ceil(_maxCandidates / 2);
	var candidates = sameCountry.slice(0, half);
	var remaining = _maxCandidates - candidates.length;
	candidates = candidates.concat(other.slice(0, remaining));

	// If we still have room and more same-country peers, add them
	if (candidates.length < _maxCandidates) {
		candidates = candidates.concat(
			sameCountry.slice(half, half + _maxCandidates - candidates.length)
		);
	}

	return candidates;
}

function _shuffle(arr) {
	for (var i = arr.length - 1; i > 0; i--) {
		var j = Math.floor(Math.random() * (i + 1));
		var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
	}
	return arr;
}

/**
 * Sign a message envelope for attestation (optional).
 * Returns { envelope, signature } or null if no server key.
 */
function _signEnvelope(publisherId, streamName, ordinal, timestamp, content) {
	if (!_serverKey) return null;
	var _crypto = require('crypto');
	var contentHash = _crypto.createHash('sha256')
		.update(typeof content === 'string' ? content : JSON.stringify(content))
		.digest('hex');

	var envelope = {
		publisherId: publisherId,
		streamName:  streamName,
		ordinal:     ordinal,
		timestamp:   timestamp,
		contentHash: contentHash
	};

	// ES256 = ECDSA with P-256 + SHA-256
	var signer = _crypto.createSign('SHA256');
	signer.update(JSON.stringify(envelope));
	var signature = signer.sign(_serverKey).toString('base64');

	return { envelope: envelope, signature: signature };
}

// ─── Exported functions to register on the socket.io client ────────────────

var PeerMeshHandlers = {

	/**
	 * Register PeerMesh handlers on a socket.io client.
	 * Call this inside socket.io.of('/Q').on('connection', function(client) { ... })
	 * after the existing Streams handlers.
	 *
	 * @method register
	 * @param {Object} client  socket.io client
	 */
	register: function (client) {
		// Relay signaling messages between peers
		client.on('Streams/PeerMesh/signal', function (data) {
			if (!data || !data.to || !data.type) return;

			var eventName;
			switch (data.type) {
				case 'offer':  eventName = 'Streams/PeerMesh/offer';  break;
				case 'answer': eventName = 'Streams/PeerMesh/answer'; break;
				case 'ice':    eventName = 'Streams/PeerMesh/ice';    break;
				default: return;
			}

			// Find the target client across all observed streams
			// (socket.io rooms or direct client reference)
			var targetClient = _findClientById(data.to);
			if (targetClient) {
				targetClient.emit(eventName, {
					from:      client.id,
					sdp:       data.sdp || undefined,
					candidate: data.candidate || undefined
				});
			}
		});

		// When this client disconnects, notify peers
		client.on('disconnect', function () {
			// Broadcast leave to all streams this client was observing
			var observing = Streams.observing[client.id];
			if (!observing) return;
			for (var publisherId in observing) {
				var streams = observing[publisherId];
				for (var streamName in streams) {
					var observers = Q.getObject(
						[publisherId, streamName], Streams.observers
					) || {};
					for (var peerId in observers) {
						if (peerId === client.id) continue;
						var peer = observers[peerId];
						if (peer && peer.connected) {
							peer.emit('Streams/PeerMesh/leave', { peerId: client.id });
						}
					}
				}
			}
		});
	},

	/**
	 * Called after a client successfully starts observing a stream.
	 * Sends Streams/PeerMesh/join with candidate peers.
	 *
	 * @method onObserve
	 * @param {Object} client  socket.io client
	 * @param {String} publisherId
	 * @param {String} streamName
	 */
	onObserve: function (client, publisherId, streamName) {
		var candidates = _findCandidates(client, publisherId, streamName);
		if (candidates.length === 0) return;

		var joinData = { peers: candidates };
		if (_serverPublicKeyRaw) {
			joinData.serverKey = _serverPublicKeyRaw.toString('base64');
		}
		client.emit('Streams/PeerMesh/join', joinData);

		// Also notify existing observers about the new peer
		// so they can probe it
		for (var i = 0; i < candidates.length; i++) {
			var peer = _findClientById(candidates[i]);
			if (peer) {
				peer.emit('Streams/PeerMesh/join', { peers: [client.id] });
			}
		}
	},

	/**
	 * Sign a message envelope for attestation.
	 * Call when posting a durable message to attach a _sidecar.
	 *
	 * @method signEnvelope
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {Number} ordinal
	 * @param {Number} timestamp
	 * @param {String} content
	 * @return {Object|null} { envelope, signature } or null
	 */
	signEnvelope: _signEnvelope
};

/**
 * Find a socket.io client by ID across all observers.
 * @private
 */
function _findClientById(clientId) {
	for (var publisherId in Streams.observers) {
		var pub = Streams.observers[publisherId];
		for (var streamName in pub) {
			var client = pub[streamName][clientId];
			if (client && client.connected) return client;
		}
	}
	return null;
}

module.exports = PeerMeshHandlers;
