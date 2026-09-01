<?php

/**
 * @module Streams
 */

/**
 * Support for Streams/QRconnect — the stream that records who connected by
 * scanning someone's code, and how a connection gets written to it.
 *
 * @class Streams_QRconnect
 */
class Streams_QRconnect
{
	/**
	 * The name of the stream connections are recorded on.
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
	 * The profile stream a QRconnect code invites people to.
	 * @method profileStreamName
	 * @static
	 * @return {string}
	 */
	static function profileStreamName()
	{
		return Q_Config::get(
			'Streams', 'QRconnect', 'profileStreamName', 'Streams/user/profile'
		);
	}

	/**
	 * Fetch a user's visits stream, optionally creating it.
	 *
	 * It's private — readLevel 0 — because a list of who scanned your code is
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
	 * Whether an accepted invite is one of the publisher's QR codes.
	 *
	 * Streams::userInviteUrl stores the url it generated in the profile
	 * stream's "userInviteUrl" attribute, and that url contains the token —
	 * so when the attribute is there, this is exact. When it isn't (the
	 * invite predates the attribute, or it has since been regenerated), fall
	 * back to the shape userInviteUrl produces: a token invite, addressed to
	 * nobody in particular, on the profile stream.
	 *
	 * @method isCodeInvite
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {Streams_Stream} $stream
	 * @return {boolean}
	 */
	static function isCodeInvite($invite, $stream)
	{
		if (!$invite or !$stream) {
			return false;
		}
		if ($stream->name !== self::profileStreamName()) {
			return false;
		}
		if (!empty($invite->userId)) {
			return false; // addressed to one person: not a code
		}
		$url = $stream->getAttribute('userInviteUrl');
		if ($url) {
			return (strpos($url, $invite->token) !== false);
		}
		return true;
	}

	/**
	 * Record that someone connected by scanning a user's code.
	 *
	 * The visitor JOINS the stream rather than posting to it. That gives a
	 * deduplicated roster the Streams/participants tool renders as-is, and
	 * Streams_Stream::join already posts "Streams/joined" the first time and
	 * "Streams/visited" on every visit after — so this feature adds no
	 * message type of its own.
	 *
	 * @method recordVisit
	 * @static
	 * @param {string} $publisherId Whose code was scanned
	 * @param {string} $visitorId
	 * @return {Streams_Participant|null}
	 */
	static function recordVisit($publisherId, $visitorId)
	{
		if (empty($visitorId) or $visitorId === $publisherId) {
			return null;
		}

		$stream = self::visitsStream($publisherId, true);
		if (!$stream) {
			return null;
		}

		return $stream->join(array(
			'userId' => $visitorId,
			'skipAccess' => true,
			'subscribed' => false
		));
	}

	/**
	 * The interests two people have in common.
	 *
	 * Interests are relations of type "Streams/interests" into each user's
	 * "Streams/user/interests" category, so this is a set intersection on
	 * (fromPublisherId, fromStreamName) — no access grant needed, which is
	 * why "see what you have in common" works on a stranger straight away.
	 *
	 * @method commonInterests
	 * @static
	 * @param {string} $userId1
	 * @param {string} $userId2
	 * @param {integer} [$limit=20]
	 * @return {array} of array('publisherId', 'streamName', 'title')
	 */
	static function commonInterests($userId1, $userId2, $limit = 20)
	{
		if (!$userId1 or !$userId2 or $userId1 === $userId2) {
			return array();
		}

		$mine = self::interestKeys($userId1);
		if (empty($mine)) {
			return array();
		}
		$theirs = self::interestKeys($userId2);
		if (empty($theirs)) {
			return array();
		}

		$common = array_intersect_key($mine, $theirs);
		if (empty($common)) {
			return array();
		}
		$common = array_slice($common, 0, $limit, true);

		$out = array();
		foreach ($common as $key => $r) {
			$parts = explode("\t", $key);
			$title = $r;
			$out[] = array(
				'publisherId' => $parts[0],
				'streamName' => $parts[1],
				// interest stream names look like "Streams/interest/art: photography"
				'title' => $title
			);
		}
		return $out;
	}

	/**
	 * Map of "publisherId\tstreamName" => display title, for a user's interests.
	 * @method interestKeys
	 * @static
	 * @param {string} $userId
	 * @return {array}
	 */
	static function interestKeys($userId)
	{
		$relations = Streams_Category::getRelatedTo(
			$userId, 'Streams/user/interests', 'Streams/interests'
		);
		if (!$relations) {
			return array();
		}
		$keys = array();
		foreach ($relations as $r) {
			$publisherId = Q::ifset($r, 'fromPublisherId', null);
			$streamName = Q::ifset($r, 'fromStreamName', null);
			if (!$publisherId or !$streamName) {
				continue;
			}
			$parts = explode('/', $streamName);
			$title = end($parts);
			$keys[$publisherId . "\t" . $streamName] = $title;
		}
		return $keys;
	}

	/**
	 * The live event both people are checked in to, if any.
	 *
	 * Uses the "attendee" role rather than going=yes, so it means someone
	 * actually came through the door — the flag the QR scanner and the
	 * attendance sheet both set — rather than someone who said yes last week.
	 *
	 * Walks the first user's Streams/participating relations rather than
	 * querying streams_participant by userId: that table is keyed
	 * (publisherId, streamName, userId) with no userId-leading index, so the
	 * category relation IS the index. Live events per person is a tiny
	 * number, so the second user is then a primary-key lookup each time.
	 *
	 * @method coPresentEvent
	 * @static
	 * @param {string} $userId1
	 * @param {string} $userId2
	 * @param {integer} [$limit=50] How many of userId1's events to consider
	 * @return {Streams_Stream|null}
	 */
	static function coPresentEvent($userId1, $userId2, $limit = 50)
	{
		if (!$userId1 or !$userId2 or $userId1 === $userId2) {
			return null;
		}

		$eventType = Q_Config::get(
			'Streams', 'QRconnect', 'coPresence', 'streamType', 'Calendars/event'
		);

		$res = Streams::related(
			$userId1, $userId1, 'Streams/participating', true,
			array('type' => $eventType, 'limit' => $limit)
		);
		$relations = (is_array($res) and isset($res[0]) and is_array($res[0]))
			? $res[0]
			: array();

		$now = time();
		foreach ($relations as $r) {
			$stream = Streams_Stream::fetch(
				$userId1, $r->fromPublisherId, $r->fromStreamName
			);
			if (!$stream) {
				continue;
			}
			$startTime = (int)$stream->getAttribute('startTime');
			$endTime = (int)$stream->getAttribute('endTime');
			if (!$startTime or $startTime > $now) {
				continue; // not started
			}
			if ($endTime and $endTime < $now) {
				continue; // already over
			}
			if (self::isAttendee($stream, $userId1)
			and self::isAttendee($stream, $userId2)) {
				return $stream;
			}
		}
		return null;
	}

	/**
	 * Whether a user is checked in to a stream.
	 * @method isAttendee
	 * @static
	 * @param {Streams_Stream} $stream
	 * @param {string} $userId
	 * @return {boolean}
	 */
	static function isAttendee($stream, $userId)
	{
		$participant = new Streams_Participant();
		$participant->publisherId = $stream->publisherId;
		$participant->streamName = $stream->name;
		$participant->streamType = $stream->type;
		$participant->userId = $userId;
		if (!$participant->retrieve(null, false, array("ignoreCache" => true))) {
			return false;
		}
		return (bool)$participant->testRoles('attendee');
	}
}
