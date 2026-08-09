<?php

/**
 * @module Streams
 */

/**
 * Support for Streams/QRconnect — the stream that records who scanned
 * someone's code, and how a visit gets written to it.
 *
 * @class Streams_QRconnect
 */
class Streams_QRconnect
{
	/**
	 * The name of the stream visits are recorded on.
	 * @method streamName
	 * @static
	 * @return {string}
	 */
	static function streamName()
	{
		return Q_Config::get(
			'Streams', 'QRconnect', 'visits', 'streamName', 'Streams/user/visits'
		);
	}

	/**
	 * Fetch a user's visits stream, optionally creating it.
	 *
	 * It's private — readLevel 0 — because a list of who visited you is
	 * nobody else's business. The publisher reads it with full access, which
	 * is all the Streams/participants tool on the connect page needs.
	 *
	 * @method visitsStream
	 * @static
	 * @param {string} $userId Whose stream
	 * @param {boolean} [$create=false] Create it if it isn't there
	 * @return {Streams_Stream|null}
	 */
	static function visitsStream($userId, $create = false)
	{
		$streamName = self::streamName();

		if (!$create) {
			return Streams_Stream::fetch($userId, $userId, $streamName);
		}

		// fields come from streams.json; repeated here so this still makes a
		// private stream if that entry hasn't been merged yet
		$results = array();
		return Streams_Stream::fetchOrCreate(
			$userId, $userId, $streamName,
			array(
				'type' => 'Streams/visits',
				'fields' => array(
					'title' => 'Visits',
					'readLevel' => 0,
					'writeLevel' => 0,
					'adminLevel' => 0
				),
				'skipAccess' => true
			),
			$results
		);
	}

	/**
	 * Record that someone visited a user's code.
	 *
	 * A logged-in visitor JOINS the stream rather than just posting to it.
	 * That gives a deduplicated roster the Streams/participants tool can
	 * render as-is, and Streams_Stream::join already posts "Streams/joined"
	 * the first time and "Streams/visited" on every visit after — so the
	 * repeat-visit history comes free, with no message type of our own.
	 *
	 * Anonymous visitors can't be participants, so those are recorded as a
	 * message instead. It's the one case where a roster can't represent a
	 * visit.
	 *
	 * @method recordVisit
	 * @static
	 * @param {string} $publisherId Whose code was scanned
	 * @param {string} $visitorId May be '' for a logged-out visitor
	 * @return {Streams_Participant|null}
	 */
	static function recordVisit($publisherId, $visitorId)
	{
		$stream = self::visitsStream($publisherId, true);
		if (!$stream) {
			return null;
		}

		if (!empty($visitorId)) {
			return $stream->join(array(
				'userId' => $visitorId,
				'skipAccess' => true,
				'subscribed' => false
			));
		}

		$stream->post($publisherId, array(
			'type' => 'Streams/profile/visited',
			'content' => '',
			'instructions' => Q::json_encode(array(
				'loggedIn' => false,
				'via' => 'inviteUrl'
			))
		), true);

		return null;
	}
}
