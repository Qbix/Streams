<?php

/**
 * @module Streams
 */

/**
 * Versioned agreements and the signatures against them.
 *
 * The document and the act of signing are separate objects with separate
 * lifecycles: one agreement, many signers, and the agreement must never change
 * after the first signature — otherwise every earlier signature points at text
 * nobody saw.
 *
 * So an agreement is a stream, immutable once signed, and a signature is a
 * participant plus an append-only message. The participant answers "is this
 * person signed right now"; the message is the record of the act and is never
 * edited or deleted.
 *
 * Stream naming: `Streams/agreement/{slug}/{version}`. A new version is a new
 * stream with `supersedes` pointing at the previous one.
 *
 * @class Streams_Agreement
 */
abstract class Streams_Agreement
{
	/**
	 * Reduces agreement text to the canonical form that gets hashed.
	 *
	 * Deliberately NOT a hash of the rendered HTML: renaming a CSS class or
	 * running a minifier would change that hash without changing a word, so two
	 * people who agreed to identical terms would end up with different hashes
	 * and you could no longer tell a cosmetic edit from a substantive one.
	 *
	 * @method canonicalText
	 * @static
	 * @param {string} $text HTML or plain text
	 * @return {string} normalized plain text
	 */
	static function canonicalText($text)
	{
		$text = preg_replace('/<(script|style)\b[^>]*>.*?<\/\1>/is', ' ', $text);
		$text = preg_replace('/<[^>]+>/', ' ', $text);
		$text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
		if (class_exists('Normalizer')) {
			$text = Normalizer::normalize($text, Normalizer::FORM_C);
		}
		$text = preg_replace('/\s+/u', ' ', $text);
		return trim($text);
	}

	/**
	 * The hash stored with the agreement and with every signature.
	 * @method hash
	 * @static
	 * @param {string} $text raw or canonical text
	 * @return {string} lowercase hex sha256 of the canonical text
	 */
	static function hash($text)
	{
		return hash('sha256', self::canonicalText($text));
	}

	/**
	 * The stream name for one version of one agreement.
	 * @method streamName
	 * @static
	 * @param {string} $slug e.g. "media-release"
	 * @param {integer} $version
	 * @return {string}
	 */
	static function streamName($slug, $version)
	{
		return 'Streams/agreement/' . Q_Utils::normalize($slug) . '/' . (int)$version;
	}

	/**
	 * Publishes a version of an agreement. Idempotent: publishing the same slug
	 * and version twice returns the existing stream, and throws if the text has
	 * changed, since a published version must never be rewritten.
	 *
	 * @method publish
	 * @static
	 * @param {string} $publisherId usually the community id
	 * @param {string} $slug
	 * @param {integer} $version
	 * @param {string} $text the full agreement text
	 * @param {array} [$options]
	 * @param {string} [$options.title]
	 * @param {string} [$options.language='en']
	 * @param {integer} [$options.supersedes] previous version number
	 * @param {string|integer} [$options.effectiveTime]
	 * @return {Streams_Stream}
	 */
	static function publish($publisherId, $slug, $version, $text, $options = array())
	{
		$name = self::streamName($slug, $version);
		$hash = self::hash($text);
		$existing = Streams::fetchOne($publisherId, $publisherId, $name);

		if ($existing) {
			if ($existing->getAttribute('hash') !== $hash) {
				throw new Q_Exception(
					"Agreement $name is already published with different text. "
					. "Publish a new version instead of editing this one."
				);
			}
			return $existing;
		}

		$language = Q::ifset($options, 'language', 'en');
		$effective = Q::ifset($options, 'effectiveTime', time());
		if (!is_numeric($effective)) {
			$effective = strtotime($effective);
		}

		$attributes = array(
			'slug' => Q_Utils::normalize($slug),
			'version' => (int)$version,
			'hash' => $hash,
			'algorithm' => 'sha256/canonicalText/1',
			'language' => $language,
			'effectiveTime' => (int)$effective
		);
		if ($s = Q::ifset($options, 'supersedes', null)) {
			$attributes['supersedes'] = self::streamName($slug, $s);
		}

		return Streams::create($publisherId, $publisherId, 'Streams/agreement', array(
			'name' => $name,
			'title' => Q::ifset($options, 'title', ucfirst(str_replace('-', ' ', $slug))),
			'content' => $text,
			'attributes' => Q::json_encode($attributes),
			'readLevel' => Streams::$READ_LEVEL['content'],
			'writeLevel' => Streams::$WRITE_LEVEL['join'],
			'adminLevel' => 0
		), array('skipAccess' => true));
	}

	/**
	 * The highest published version of an agreement.
	 * @method current
	 * @static
	 * @param {string} $publisherId
	 * @param {string} $slug
	 * @return {Streams_Stream|null}
	 */
	static function current($publisherId, $slug)
	{
		$prefix = 'Streams/agreement/' . Q_Utils::normalize($slug) . '/';
		$rows = Streams_Stream::select('*')->where(array(
			'publisherId' => $publisherId,
			'name' => new Db_Range($prefix, true, false, $prefix . 'z')
		))->fetchDbRows();

		$best = null;
		foreach ($rows as $row) {
			if (!$best or (int)$row->getAttribute('version') > (int)$best->getAttribute('version')) {
				$best = $row;
			}
		}
		return $best;
	}

	/**
	 * Records a signature.
	 *
	 * The hash the signer saw is compared against the stream's own hash, so a
	 * stale page cannot produce a signature against text the person never read.
	 *
	 * @method sign
	 * @static
	 * @param {string} $userId
	 * @param {Streams_Stream|string} $agreement stream or its name
	 * @param {array} [$options]
	 * @param {string} [$options.hash] the hash as rendered to the signer
	 * @param {string} [$options.method='checkbox'] the affirmative act
	 * @param {string} [$options.label] the exact wording of the control they used
	 * @param {string} [$options.language] the translation they were shown
	 * @param {string} [$options.publisherId]
	 * @return {array} the signature record
	 */
	static function sign($userId, $agreement, $options = array())
	{
		$publisherId = Q::ifset($options, 'publisherId', Users::communityId());
		if (is_string($agreement)) {
			$agreement = Streams::fetchOne($publisherId, $publisherId, $agreement, true);
		}

		$hash = $agreement->getAttribute('hash');
		$seen = Q::ifset($options, 'hash', null);
		if ($seen !== null and $seen !== $hash) {
			throw new Q_Exception_WrongValue(array(
				'field' => 'hash',
				'range' => "the hash of the agreement being signed ($hash)"
			));
		}

		$evidence = array(
			'userId' => $userId,
			'hash' => $hash,
			'algorithm' => $agreement->getAttribute('algorithm'),
			'version' => (int)$agreement->getAttribute('version'),
			// The translation a person was shown IS what they agreed to.
			'language' => Q::ifset($options, 'language', $agreement->getAttribute('language')),
			'method' => Q::ifset($options, 'method', 'checkbox'),
			'label' => Q::ifset($options, 'label', ''),
			'ip' => self::ipString(),
			'userAgent' => substr((string)Q::ifset($_SERVER, 'HTTP_USER_AGENT', ''), 0, 255),
			'signedTime' => time()
		);

		$agreement->join(array('userId' => $userId, 'subscribed' => false));

		$participant = self::participantRow($agreement, $userId);
		$participant->setExtra('signature', $evidence);
		$participant->save();

		// Append-only record of the act itself. Never edited, never deleted —
		// a revocation is a later message, not a change to this one.
		$agreement->post($userId, array(
			'type' => 'Streams/agreement/signed',
			'content' => 'Signed ' . $agreement->title . ' v' . $evidence['version'],
			'instructions' => Q::json_encode($evidence)
		), true);

		return $evidence;
	}

	/**
	 * Whether a user has a live signature on an agreement.
	 * @method signed
	 * @static
	 * @param {string} $userId
	 * @param {Streams_Stream|string} $agreement
	 * @param {array} [$options]
	 * @param {string} [$options.publisherId]
	 * @return {array|false} the signature record, or false
	 */
	static function signed($userId, $agreement, $options = array())
	{
		$publisherId = Q::ifset($options, 'publisherId', Users::communityId());
		if (is_string($agreement)) {
			$agreement = Streams::fetchOne($publisherId, $publisherId, $agreement);
		}
		if (!$agreement) {
			return false;
		}
		$participant = self::participantRow($agreement, $userId, false);
		if (!$participant or $participant->state !== 'participating') {
			return false;
		}
		$signature = $participant->getExtra('signature');
		if (!$signature) {
			return false;
		}
		$signature = is_string($signature) ? Q::json_decode($signature, true) : (array)$signature;
		return empty($signature['revokedTime']) ? $signature : false;
	}

	/**
	 * Withdraws consent going forward.
	 *
	 * This blocks future use. It does not unmake past use — anything already
	 * published under the agreement is a separate question, so the signature
	 * record is kept rather than deleted.
	 *
	 * @method revoke
	 * @static
	 * @param {string} $userId
	 * @param {Streams_Stream|string} $agreement
	 * @param {array} [$options]
	 * @return {boolean} false if there was nothing to revoke
	 */
	static function revoke($userId, $agreement, $options = array())
	{
		$publisherId = Q::ifset($options, 'publisherId', Users::communityId());
		if (is_string($agreement)) {
			$agreement = Streams::fetchOne($publisherId, $publisherId, $agreement, true);
		}
		$participant = self::participantRow($agreement, $userId, false);
		if (!$participant) {
			return false;
		}
		$signature = $participant->getExtra('signature');
		$signature = is_string($signature) ? Q::json_decode($signature, true) : (array)$signature;
		if (!$signature or !empty($signature['revokedTime'])) {
			return false;
		}
		$signature['revokedTime'] = time();
		$signature['revokedReason'] = Q::ifset($options, 'reason', '');
		$participant->setExtra('signature', $signature);
		$participant->save();

		$agreement->post($userId, array(
			'type' => 'Streams/agreement/revoked',
			'content' => 'Withdrew consent to ' . $agreement->title,
			'instructions' => Q::json_encode(array(
				'userId' => $userId,
				'revokedTime' => $signature['revokedTime'],
				'reason' => $signature['revokedReason']
			))
		), true);
		return true;
	}

	/**
	 * Every signature message on an agreement, oldest first. This is the audit
	 * trail; the participant rows are only the current state.
	 * @method signatures
	 * @static
	 * @param {Streams_Stream|string} $agreement
	 * @param {array} [$options]
	 * @return {array} of Streams_Message
	 */
	static function signatures($agreement, $options = array())
	{
		$publisherId = Q::ifset($options, 'publisherId', Users::communityId());
		$name = is_string($agreement) ? $agreement : $agreement->name;
		return Streams_Message::fetch($publisherId, $name, array(
			'type' => 'Streams/agreement/signed',
			'ascending' => true,
			'limit' => Q::ifset($options, 'limit', 1000)
		));
	}

	/**
	 * Q_Request::ip() can hand back an array when proxies are in play, and the
	 * evidence record has to be a plain string.
	 * @method ipString
	 * @static
	 * @return {string}
	 */
	static function ipString()
	{
		$ip = Q_Request::ip();
		if (is_array($ip)) {
			$ip = reset($ip);
		}
		return substr((string)$ip, 0, 63);
	}

	/**
	 * The participant row, read fresh. $stream->participant() serves a cached
	 * object, so a row written just after join() would not be seen.
	 * @method participantRow
	 * @static
	 * @param {Streams_Stream} $agreement
	 * @param {string} $userId
	 * @param {boolean} [$create=true] return an unsaved row if none exists
	 * @return {Streams_Participant|null}
	 */
	static function participantRow($agreement, $userId, $create = true)
	{
		$p = new Streams_Participant();
		$p->publisherId = $agreement->publisherId;
		$p->streamName = $agreement->name;
		$p->userId = $userId;
		if ($p->retrieve(null, false, array('ignoreCache' => true))) {
			return $p;
		}
		return $create ? $p : null;
	}
}
