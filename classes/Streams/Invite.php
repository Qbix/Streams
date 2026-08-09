<?php
/**
 * @module Streams
 */
/**
 * Class representing 'Invite' rows in the 'Streams' database
 * You can create an object of this class either to
 * access its non-static methods, or to actually
 * represent a invite row in the Streams database.
 *
 * @class Streams_Invite
 * @extends Base_Streams_Invite
 */
class Streams_Invite extends Base_Streams_Invite
{
	/**
	 * The setUp() method is called the first time
	 * an object of this class is constructed.
	 * @method setUp
	 */
	function setUp()
	{
		parent::setUp();
	}
	
	/**
	 * Returns the shareable URL corresponding to the invite
	 * @return {string}
	 */
	function url()
	{
		return Streams::inviteUrl($this->token);
	}
	
	/**
	 * Get the invites that have been left for one or more users in some stream.
	 * This is useful for auto-accepting them or presenting the user with a
	 * button to accept the invite when the stream is rendered on their client.
	 * @method forStream
	 * @static
	 * @param {string} $publisherId
	 * @param {string|array|Db_Expression} $streamName
	 * @param {string|array|Db_Expression} $userId
	 * @return {array} an array of Streams_Invite objects
	 */
	static function forStream($publisherId, $streamName, $userId = null)
	{
		if (!isset($userId)) {
			$user = Users::loggedInUser();
			if ($user) {
				return null;
			}
			$userId = $user->id;
		}
		return Streams_Invite::select()->where(
			@compact('publisherId', 'streamName', 'userId')
		)->fetchDbRows();
	}
	
	/**
	 * Call this to check if the user is not yet participating in the stream,
	 * and has an invite pending. If so, a notice is set, with a button to accept
	 * the invite.
	 * @param {Streams_Stream} $stream The stream to check
	 * @param {array} [$options=array()] Options to pass to Q_Response::setNotice(),
	 *  and also these:
	 * @param {string|array} [$options.notice] Information for the notice
	 * @param {string|array} [$options.notice.html] HTML to display in the notice.
	 *  This is a handlebars template which receives the fields
	 *  {{stream}}, {{clickOrTap}} and {{ClickOrTap}}.
	 *  Defaults to the array("Streams/content", array("invite", "notice", "html"))
	 * @param {array} [$options.userId=Users::loggedInUser()->id] The user to check
	 * @return {boolean} Whether the notice was set
	 */
	static function possibleNotice($stream, $options = array())
	{
		$userId = Q::ifset($options, 'userId', null);
		if (!$userId) {
			$user = Users::loggedInUser(false, false);
			if (!$user) {
				return false;
			}
			$userId = $user->id;
		}
		if (!($stream instanceof Streams_Stream) || $stream->participant()) {
			return false;
		}
		$invites = Streams_Invite::forStream($stream->publisherId, $stream->name, $userId);
		$invite = reset($invites); // for now just take the first one you find
		if (!$invite or $invite->state !== 'pending') {
			return false;
		}
		$defaultHtml = array("Streams/content", array("invite", "notice", "html"));
		$html = Q::ifset($options, 'notice', 'html', null, $defaultHtml);
		$button = '<button class="Streams_possibleNotice_button">';
		$clickOrTap = Q_Text::clickOrTap(false);
		$ClickOrTap = Q_Text::clickOrTap(true);
		$buttonClass = 'Streams_invite_accept_button';
		$html = Q_Handlebars::render($html, @compact(
			'stream', 'clickOrTap', 'ClickOrTap'
		));
		$key = 'Streams_Invite_possibleNotice';
		$options['handler'] = $invite->url();
		Q_Response::setNotice($key, $html, $options);
		return true;
	}
	
	/**
	 * Accept the invite and set up the user's access levels
	 * If invite was already accepted, this function simply returns null
	 * @method accept
	 * @param {array} $options
	 *  These options are passed to stream->subscribe() and stream->join()
	 *  but can also include the following:
	 * @param {boolean} [$options.subscribe=false]
	 *  Whether to auto-subscribe them to the stream if not already subscribed.
	 *  If the subscribe() call throws an exception, it is swallowed.
	 * @param {boolean} [$options.access=true]
	 *  Whether to upgrade the user's access to the stream, based on the invite
	 * @param {boolean} [$options.skipExpires=false]
	 *  Whether to skip checking the "expires" extra in the invite, for a timestamp in the past
	 * @return {Streams_Participant|false|null}
	 * @throws {Users_Exception_NotLoggedIn}
	 *  If the $this->userId is false and user is not logged in
	 */
	function accept($options = array())
	{
		if (!isset($options['access'])) {
			$options['access'] = true;
		}

		$invite = $this;
		$saved = false;
		$userId = $this->userId ? $this->userId : Users::loggedInUser(true)->id;

		if (!empty($options['skipExpires'])) {
			$expires = $this->getExtra('expires');
			if ($expires and $expires <= time()) {
				throw new Streams_Exception_InviteExpired();
			}
		}
		
		$invited = new Streams_Invited();
		$invited->token = $this->token;
		$invited->userId = $userId;
		if ($this->userId) {
			if ($this->state == 'accepted') {
				return false; // already exists
			}
			$invited->state = 'accepted';
			$invited->save(true);
			$saved = true;
		} else if (!$invited->retrieve() or $invited->state !== 'accepted') {
			$quotaName = "Streams/invite";
			$roles = Users::roles($this->publisherId, null, null, $invite->invitingUserId);
			$quota = Users_Quota::check($invite->invitingUserId, $this->token, $quotaName, true, 1, array_keys($roles));

			$invited2 = new Streams_Invited();
			$invited2->token = $invited->token;
			$invited2->userId = $invited->userId;
			if ($invited->retrieve()) {
				return false; // already exists
			}
			$invited2->state = 'accepted';
			$invited2->expireTime = $this->expireTime;
			$invited2->save();

			$quota->used(1);
			$saved = true;
		}

		// INVITE: set the invite as the latest invite in the session,
		// and schedule the invite to be accepted after the user logs in,
		// if the invite didn't have a specific userId 
		Q_Session::setNonce();
		$_SESSION['Streams']['invite'] = $this->fields;
		unset($_SESSION['Streams']['inviteFollowedToken']);

		// Handle referral
		$referredAction = 'Streams/invite/accept';
		$referred = Users_Referred::handleReferral($userId, $this->publisherId, $referredAction, '');

		if (!$saved) {
			return false;
		}

		/**
		 * @event Streams/invite {before}
		 * @param {Streams_Invite} stream
		 * @param {Users_User} user
		 */
		if (Q::event("Streams/invite/accept", @compact('invite', 'userId', 'referred'), 'before') === false) {
			return false;
		}

		// $this->userId = $userId;
		$this->state = 'accepted';
		if (!$this->save() and $this->userId) {
			return false;
		}

		$stream = Streams_Stream::fetch(
			$this->userId, $this->publisherId, $this->streamName, true
		);

		$instructions = Q::take($this->fields, array(
			'token', 'userId', 'invitingUserId', 'appUrl',
			'readLevel', 'writeLevel', 'adminLevel', 'permissions',
			'ofUserId', 'ofContactLabel'
		));

		$stream->post($userId, array(
			'type' => 'Streams/invite/accept',
			'instructions' => $instructions
		), true);

		$user = Users::fetch($userId, true);
		Q_Utils::sendToNode(array(
			"Q/method" => "Users/emitToUser",
			"userId" => $invite->invitingUserId,
			"event" => "Streams/invite/accept",
			"data" => array(
				"invitedUserId" => $userId,
				"displayName" => $user->displayName(),
				"icon" => $user->icon
			)
		));
		
		if (!empty($options['access'])) {
			// Check if the users exist
			$invitedUser = Users_User::fetch($userId, true);
			$byUser = Users_User::fetch($this->invitingUserId, true);
			// Set up the objects
			$toStream = Streams_Stream::fetch(
				$this->invitingUserId, $this->publisherId, $this->streamName, true
			);
			$access = new Streams_Access();
			$access->publisherId = $toStream->publisherId;
			$access->streamName = $toStream->name;
			$access->ofUserId = $userId;
			// Check if we should update the access
			$shouldUpdateAccess = false;
			foreach (array('readLevel', 'writeLevel', 'adminLevel') as $level_type) {
				$access->$level_type = -1;
				if (empty($this->$level_type)) {
					continue;
				}
				// Give access level from the invite.
				// However, if inviting user has a lower access level now,
				// then give that level instead, unless it is lower than
				// what the invited user would have had otherwise.
				$min = min($this->$level_type, $toStream->get($level_type, 0));
				if ($min > $stream->get($level_type, 0)) {
					$access->$level_type = $min;
					$shouldUpdateAccess = true;
				}
			}
			if (!empty($access->permissions)) {
				// Grant permissions originally offered in the invite,
				// up to and including what the inviting user currently has.
				$permissions = Q::json_decode($access->permissions);
				$withPermissions = $toStream->get('permissions', array());
				foreach ($permissions as $permission) {
					if (in_array($permission, $withPermissions)) {
						$access->addPermission($permission);
					}
				}
			}
			if ($shouldUpdateAccess) {
				$access->save(true);
			}
		}

		// add roles
		$extra = Q::json_decode($this->extra ?: '{}', true);
		if ($labels = Q::ifset($extra, 'addLabel', null)) {
			if (!is_array($labels)) {
				$labels = array($labels);
			}
			// $can = Users_Label::can($stream->publisherId, $this->invitingUserId);
			// if (1 or $can["manageContacts"]) { // don't need to check manageContacts here
				foreach ($labels as $label) {
					Users_Contact::addContact(
						$stream->publisherId, $label, $userId,
						null, $this->invitingUserId, true
					);
				}
			// }
		}
		// add relationships
		if ($labels = Q::ifset($extra, 'addMyLabel', null)) {
			if (!is_array($labels)) {
				$labels = array($labels);
			}
			$can = Users_Label::can($stream->publisherId, $this->invitingUserId);
			if ($can["manageContacts"]) {
				foreach ($labels as $label) {
					Users_Contact::addContact(
						$this->invitingUserId, $label, $userId,
						null, $this->invitingUserId, true
					);
				}
			}
		}
		$addLabel = Q::ifset($extra, 'addLabel', null);

		Users_Contact::addContact($this->invitingUserId, "Streams/invited", $userId, null, false, true);
		Users_Contact::addContact($this->invitingUserId, "Streams/invited/{$stream->type}", $userId, null, false, true);
		Users_Contact::addContact($userId, "Streams/invitedMe", $this->invitingUserId, null, false, true);
		Users_Contact::addContact($userId, "Streams/invitedMe/{$stream->type}", $this->invitingUserId, null, false, true);

		// recalculate access based on the new Contact and Access rows
		$stream->calculateAccess($userId, true);

		// subscribe or join, if needed
		$onInviteAccepted = Streams_Stream::getConfigField($stream->type, "onInviteAccepted", null);
		if ($onInviteAccepted) {
			if (!is_array($onInviteAccepted)) {
				$onInviteAccepted = [$onInviteAccepted];
			}
			$options["subscribe"] = in_array("subscribe", $onInviteAccepted);
			$options["join"] = in_array("join", $onInviteAccepted);
		}
		if (Q::ifset($options, "subscribe", false)) {
			$participant = new Streams_Participant();
			$participant->publisherId = $stream->publisherId;
			$participant->streamName = $stream->name;
			$participant->userId = $userId;
			if (!$participant->retrieve()
			|| $participant->state != "participating"
			|| $participant->subscribed != "yes") {
				try {
					$participantExtra = Q::ifset($options, 'extra', array());
					$configExtra = Streams_Stream::getConfigField($stream->type, array(
						'invite', 'extra'
					), array());
					$participantExtra = array_merge($configExtra, $participantExtra);
					if ($addLabel) {
						$participantExtra["role"] = $addLabel;
					}
					$options['extra'] = $participantExtra;
					$stream->subscribe($options);
				} catch (Exception $e) {
					// Swallow this exception. If the caller wanted to catch
					// this exception, they could have written this code block themselves.
				}
			} else {
				if ($addLabel) {
					$participant->grantRoles($addLabel)->save();
				}
			}
		} else if (Q::ifset($options, "join", true)) {
			$participant = $stream->join(array(
				'userId' => $userId,
				'extra' => array('Streams/invitingUserId' => $this->invitingUserId),
				'noVisit' => true
			));
			if ($participant && $addLabel) {
				$participant->grantRoles($addLabel)->save();
			}
		}

		// NOTE: this must run AFTER the subscribe/join block above.
		// $stream->join() creates or replaces the participant row and
		// overwrites its extra, so granting roles before it silently
		// discards them.
		// add participant roles offered in the invite
		if ($proles = Q::ifset($extra, 'addParticipantRole', null)) {
			if (is_string($proles)) {
				$proles = array_map('trim', explode("\t", $proles));
			} else if (Q::isAssociative($proles)) {
				$proles = array_keys($proles);
			}
			// only grant roles declared for this stream type, and only ones the
			// INVITER was entitled to offer -- same containment rule as the
			// permissions grant above, checked now rather than at compose time
			$declared = array_keys(Streams_Participant::rolesConfig($stream->type));
			$can = Streams_Participant::can(
				$stream->publisherId, $stream->name, $this->invitingUserId
			);
			$granting = array();
			foreach ($proles as $role) {
				if (in_array($role, $declared) and in_array($role, $can['grant'])) {
					$granting[] = $role;
				}
			}
			if ($granting) {
				$p = new Streams_Participant(array(
					'publisherId' => $stream->publisherId,
					'streamName' => $stream->name,
					'userId' => $userId
				));
				if (!$p->retrieve()) {
					$p->streamType = $stream->type;
					$p->state = 'participating';
				}
				$p->grantRoles($granting); // already checked above
				$p->save(true);
			}
		}

		/**
		 * @event Streams/invite {after}
		 * @param {Streams_Invite} stream
		 * @param {Users_User} user
		 */
		Q::event("Streams/invite/accept", @compact('invite', 'stream', 'userId'), 'after');

		return true;
	}

	/**
	 * Retrieves invite
	 * @method getInvite
	 * @static
	 * @param {string} $token
	 * @param {boolean} $throwIfMissing
	 * @return {Streams_Invite|null}
	 */
	static function fromToken ($token, $throwIfMissing = false) {
		if (empty($token)) {
			return null;
		}
		if (!empty(self::$cache['fromToken'][$token])) {
			return self::$cache['fromToken'][$token];
		}
		$invite = new Streams_Invite();
		$invite->token = $token;
		if (!$invite->retrieve()) {
			if ($throwIfMissing) {
				throw new Q_Exception_MissingRow(array(
					'table' => 'Invite',
					'criteria' => Q::json_encode(@compact('token'))
				));
			}
			return null;
		}
		self::$cache['fromToken'][$token] = $invite;
		return $invite;
	}
	
	/**
	 * Generate a unique token that can be used for invites
	 * @method generateToken
	 * @static
	 * @return {string}
	 */
	static function generateToken()
	{
		return self::db()->uniqueId(
			self::table(),
			'token',
			null,
			array(
				'length' => Q_Config::get('Streams', 'invites', 'tokens', 'length', 16),
				'characters' => Q_Config::get('Streams', 'invites', 'tokens', 'characters', 'abcdefghijklmnopqrstuvwxyz')
			)
		);
	}

	/**
	 * @method getAllExtras
	 * @return {array} The array of all extras set in the stream
	 */
	function getAllExtras()
	{
		return empty($this->extra)
			? array()
			: json_decode($this->extra, true);
	}

	/**
	 * @method getExtra
	 * @param {string} $extraName The name of the extra to get
	 * @param {mixed} $default The value to return if the extra is missing
	 * @return {mixed} The value of the extra, or the default value, or null
	 */
	function getExtra($extraName, $default = null)
	{
		$attr = $this->getAllExtras();
		return isset($attr[$extraName]) ? $attr[$extraName] : $default;
	}

	/**
	 * @method setExtra
	 * @param {string} $extraName The name of the extra to set,
	 *  or an array of $extraName => $extraValue pairs
	 * @param {mixed} $value The value to set the extra to
	 * @return Streams_Invite
	 */
	function setExtra($extraName, $value = null)
	{
		$attr = $this->getAllExtras();
		if (is_array($extraName)) {
			foreach ($extraName as $k => $v) {
				$attr[$k] = $v;
			}
		} else {
			$attr[$extraName] = $value;
		}
		$this->extra = Q::json_encode($attr, Q::JSON_FORCE_OBJECT);

		return $this;
	}

	/**
	 * @method clearExtra
	 * @param {string} $extraName The name of the extra to remove
	 */
	function clearExtra($extraName)
	{
		$attr = $this->getAllExtras();
		unset($attr[$extraName]);
		$this->extra = Q::json_encode($attr, Q::JSON_FORCE_OBJECT);;
	}

	/**
	 * @method clearAllExtras
	 */
	function clearAllExtras()
	{
		$this->extra = '{}';
	}

	/**
	 * Assigns unique id to 'token' field if not set
	 * Saves corresponding row in Streams_Invited table
	 * Inserting a new invite affects corresponding row in Streams_Participant table
	 * @method beforeSave
	 * @param {array} $modifiedFields
	 *	The fields that have been modified
	 * @return {array}
	 */
	function beforeSave($modifiedFields)
	{
		if (!$this->retrieved) {
			if (!isset($modifiedFields['token'])) {
				$this->token = $modifiedFields['token'] = self::generateToken();
			}
			if (!empty($modifiedFields['userId'])) {
				$p = new Streams_Participant();
				$p->publisherId = $modifiedFields['publisherId'];
				$p->streamName = $modifiedFields['streamName'];
				$p->userId = $modifiedFields['userId'];
				$p->state = 'invited';
				// streamType must be set: hooks on Streams_Participant read it via
				// Db_Row::__get(), which throws on fields that were never set. Without
				// this, creating any invite addressed to a specific userId fatals as
				// soon as a plugin hooks that event (e.g. Calendars).
				$stream = Streams_Stream::fetch(
					$modifiedFields['userId'],
					$modifiedFields['publisherId'],
					$modifiedFields['streamName']
				);
				$p->streamType = $stream ? $stream->type : '';
				$p->save(true);
			}
		}

		if (!empty($modifiedFields['userId'])) {
			if (array_key_exists('state', $modifiedFields)
			or array_key_exists('expireTime', $modifiedFields)) {
				$invited = new Streams_Invited();
				$invited->userId = $this->userId; // shouldn't change
				$invited->token = $this->token; // shouldn't change
				if (array_key_exists('state', $modifiedFields)) {
					$invited->state = $modifiedFields['state'];
				}
				if (array_key_exists('expireTime', $modifiedFields)) {
					$invited->expireTime = $modifiedFields['expireTime'];
				}
				$invited->save(true);
			}
		}
		
		return parent::beforeSave($modifiedFields);
	}
	
	/**
	 * Also removes counterpart row in Streams_Invited table
	 * @method beforeSave
	 * @param {array} $pk
	 *	The primary key fields
	 * @return {boolean}
	 */
	function beforeRemove($pk)
	{
		if ($this->userId) {
			$invited = new Streams_Invited();
			$invited->userId = $this->userId;
			$invited->token = $this->token;
			$invited->remove();
		}
		return true;
	}

	/**
	 * Returns the latest invite that was accepted in this session
	 * or set to be accepted when user logs in;
	 * or if that is missing, the invite that was followed (but not accepted yet).
	 * @method tokenInSession
	 * @static
	 * @return {Streams_Invite|null}
	 */
	static function tokenInSession($onlyAccepted = false)
	{
		$followed = Q::ifset($_SESSION, 'Streams', 'invite', 'token', null);
		$accepted = Q::ifset($_SESSION, 'Streams', 'inviteFollowedToken', null);
		return $onlyAccepted ? $accepted : ($accepted ? $accepted : $followed);
	}

	/**
	 * Whether this invite may be accepted on the user's behalf, without asking.
	 * The default is NO. The one exception is a general invite link followed by
	 * someone in their very first session -- better to subscribe them to
	 * something than to nothing, and they can always unsubscribe.
	 *
	 * A personal link (invite->userId set) never qualifies: it auto-logs them
	 * in, and being logged in is not the same as having agreed to join.
	 *
	 * @method shouldAutoAccept
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {Streams_Stream} $stream
	 * @param {Users_User} [$user]
	 * @return {boolean}
	 */
	/**
	 * The state of this invite AS IT APPLIES TO ONE PERSON.
	 *
	 * streams_invite.state is shared. For a general link (userId '') one token
	 * is followed by many people, and accept() flips that shared column -- so
	 * reading it directly means the first person to accept marks the link
	 * resolved for everyone else. The per-person record is streams_invited,
	 * keyed on (userId, token).
	 *
	 * expired / claimed / forwarded describe the LINK rather than a person, so
	 * those still come from the invite row and apply to everybody.
	 *
	 * @method stateFor
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {string} [$userId=null] Defaults to the logged-in user.
	 * @return {string} pending, accepted, declined, expired, claimed or forwarded
	 */
	static function stateFor($invite, $userId = null)
	{
		if (in_array($invite->state, array('expired', 'claimed', 'forwarded'))) {
			return $invite->state; // properties of the link itself
		}
		if ($invite->userId) {
			return $invite->state; // personal invite: the row IS the record
		}
		if (!isset($userId)) {
			$user = Users::loggedInUser(false, false);
			$userId = $user ? $user->id : null;
		}
		if (!$userId) {
			return 'pending'; // nobody yet, so nothing resolved for them
		}
		$invited = new Streams_Invited(array(
			'token' => $invite->token, 'userId' => $userId
		));
		return $invited->retrieve() ? $invited->state : 'pending';
	}

	/**
	 * Whether this invite may be accepted on the user's behalf, without asking.
	 * The default is NO. The one exception is a general invite link followed by
	 * someone in their very first session.
	 *
	 * @method shouldAutoAccept
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {Streams_Stream} $stream
	 * @param {Users_User} [$user]
	 * @return {boolean}
	 */
	static function shouldAutoAccept($invite, $stream, $user = null)
	{
		if (!$user) {
			return false; // nobody to accept on behalf of
		}
		if ($invite->userId) {
			return false; // personal link: autologin is not consent
		}
		if ($invite->getExtra('dontAutoAccept')) {
			return false;
		}
		if (!Streams_Stream::getConfigField(
			$stream->type, array('invite', 'autoAccept'), false
		)) {
			return false;
		}
		$max = Q_Config::get('Streams', 'invite', 'autoAccept', 'sessionCountMax', 1);
		return (intval($user->sessionCount) <= intval($max));
	}

	/**
	 * @method needsExplicitConsent
	 * @static
	 * @deprecated use the positive form, shouldAutoAccept()
	 */
	static function needsExplicitConsent($invite, $stream, $user = null)
	{
		return !self::shouldAutoAccept($invite, $stream, $user);
	}

	/**
	 * Decline a pending invite. Unlike leaving it pending, this is durable:
	 * the same link will not re-prompt, and Streams_before_Q_objects reports
	 * Streams_Exception_AlreadyDeclined if it is followed again.
	 * @method decline
	 * @return {boolean}
	 */
	/**
	 * Everyone this user invited, and what became of it.
	 *
	 * Lives here rather than in its own class because every method below starts
	 * by querying streams_invite, and because "referral" already means two other
	 * things nearby: Users_Referred is the table of *credited* referrals, and
	 * Websites_Referral is outbound tracked-link creation. Neither is this.
	 *
	 * Streams_Invite records who was invited and whether they accepted.
	 * Users_Referred records that a referral was credited, with points. They are
	 * written at different times by different code, so they drift -- which is
	 * what the discrepancy flag and scripts/Streams/referrals.php are for.
	 *
	 * Inclusion rules, per person:
	 *  - accepted invites are always included
	 *  - unaccepted invites only when the invite named a specific user who has
	 *    since signed in at least once (sessionCount > 0)
	 *  - a general invite link nobody accepted is skipped: acceptance is what
	 *    stamps a userId onto the invite, so there is no person to show
	 *
	 * @method referrals
	 * @static
	 * @param {string} [$byUserId=null] Defaults to the logged-in user.
	 * @param {array} [$options=array()]
	 * @param {string} [$options.communityId] Restrict to this community.
	 * @param {integer} [$options.limit=500]
	 * @param {boolean} [$options.includeUnaccepted=true]
	 * @return {array} Rows, newest invite first.
	 */
	static function referrals($byUserId = null, $options = array())
	{
		if (!isset($byUserId)) {
			$user = Users::loggedInUser(false, false);
			if (!$user) {
				return array();
			}
			$byUserId = $user->id;
		}
		$limit = Q::ifset($options, 'limit', 500);
		$includeUnaccepted = Q::ifset($options, 'includeUnaccepted', true);
		$communityId = Q::ifset($options, 'communityId', null);

		$invites = self::select()
			->where(array('invitingUserId' => $byUserId))
			->orderBy('insertedTime', false)
			->limit($limit)
			->fetchDbRows();
		if (!$invites) {
			return array();
		}

		// A general invite (userId '') is never stamped with an accepter --
		// accept() leaves streams_invite.userId empty and records the person in
		// streams_invited instead. Without this join, everyone who joined via a
		// shared link is invisible here, which is most of them.
		$tokens = array();
		foreach ($invites as $invite) {
			$tokens[] = $invite->token;
		}
		$acceptersByToken = array();
		foreach (Streams_Invited::select()->where(array(
			'token' => $tokens
		))->fetchDbRows() as $iv) {
			$acceptersByToken[$iv->token][] = $iv->userId;
		}

		$userIds = array();
		foreach ($invites as $invite) {
			if ($invite->userId) {
				$userIds[$invite->userId] = true;
			}
			foreach (Q::ifset($acceptersByToken, $invite->token, array()) as $uid) {
				$userIds[$uid] = true;
			}
		}
		$userIds = array_keys($userIds);
		$users = $userIds
			? Users_User::select()->where(array('id' => $userIds))
				->fetchDbRows(null, '', 'id')
			: array();

		// Batch the avatars. Calling $user->displayName() per row fires the
		// Users/User/displayName event, which Streams answers out of
		// streams_avatar -- one query per person unless they're fetched together.
		$avatars = $userIds
			? Streams_Avatar::fetch($byUserId, $userIds, 'publisherId')
			: array();

		$referred = array();
		if ($userIds) {
			$criteria = array(
				'userId' => $userIds,
				'referredByUserId' => $byUserId
			);
			if ($communityId) {
				$criteria['toCommunityId'] = $communityId;
			}
			foreach (Users_Referred::select()->where($criteria)->fetchDbRows() as $r) {
				$referred[$r->userId] = $r;
			}
		}

		$rows = array();
		$seen = array();
		foreach ($invites as $invite) {
			// one invite row can map to several people when it's a general link
			$people = $invite->userId
				? array($invite->userId)
				: Q::ifset($acceptersByToken, $invite->token, array());
			foreach ($people as $userId) {
			if (isset($seen[$userId])) {
				continue; // already have this person from a newer invite
			}
			// per-person: a general link's shared state says nothing about
			// whether THIS person accepted
			$accepted = (self::stateFor($invite, $userId) === 'accepted');
			$u = Q::ifset($users, $userId, null);
			$sessionCount = $u ? intval($u->sessionCount) : 0;
			if (!$accepted and (!$includeUnaccepted or $sessionCount < 1)) {
				continue; // never signed in: nothing meaningful to show
			}
			$seen[$userId] = true;

			$avatar = Q::ifset($avatars, $userId, null);
			$r = Q::ifset($referred, $userId, null);
			$rows[] = array(
				'userId' => $userId,
				'displayName' => $avatar
					? $avatar->displayName(array('short' => true))
					: $userId,
				'icon' => $avatar ? $avatar->iconUrl(40) : null,
				'inviteState' => $invite->state,
				'accepted' => $accepted,
				'invitedTime' => Q::ifset($invite->fields, 'insertedTime', null),
				'sessionCount' => $sessionCount,
				'publisherId' => $invite->publisherId,
				'streamName' => $invite->streamName,
				'referredRow' => $r,
				'points' => $r ? intval($r->points) : 0,
				'qualifiedTime' => $r ? $r->qualifiedTime : null,
				// accepted the invite, but nobody was ever credited for it
				'discrepancy' => ($accepted and !$r)
			);
			}
		}
		return $rows;
	}

	/**
	 * Rows where the invite was accepted but no Users_Referred row exists.
	 * These are what scripts/Streams/referrals.php acts on.
	 * @method referralDiscrepancies
	 * @static
	 * @param {string} [$byUserId=null]
	 * @param {array} [$options=array()]
	 * @return {array}
	 */
	static function referralDiscrepancies($byUserId = null, $options = array())
	{
		$out = array();
		foreach (self::referrals($byUserId, $options) as $row) {
			if ($row['discrepancy']) {
				$out[] = $row;
			}
		}
		return $out;
	}

	/**
	 * Totals, for the header of a referrals panel.
	 * @method referralSummary
	 * @static
	 * @param {array} $rows Output of referrals()
	 * @return {array}
	 */
	static function referralSummary($rows)
	{
		$s = array(
			'people' => count($rows), 'accepted' => 0, 'notAccepted' => 0,
			'credited' => 0, 'points' => 0, 'discrepancies' => 0
		);
		foreach ($rows as $row) {
			$row['accepted'] ? ++$s['accepted'] : ++$s['notAccepted'];
			if ($row['referredRow']) {
				++$s['credited'];
				$s['points'] += $row['points'];
			}
			if ($row['discrepancy']) {
				++$s['discrepancies'];
			}
		}
		return $s;
	}

	/**
	 * Which community a given invite's referral should be scoped to.
	 *
	 * accept() above passes $this->publisherId into handleReferral() as the
	 * communityId. That is correct when a community publishes the stream and
	 * wrong when a person does -- and Calendars/event streams routinely have a
	 * person as publisher with the community in attributes.communityId. When
	 * that happens the referral is scoped to a user id, and later
	 * Users_Referred::referrer() lookups keyed on a community never find it.
	 *
	 * @method communityIdForReferral
	 * @static
	 * @param {Streams_Invite} $invite
	 * @return {string|null}
	 */
	static function communityIdForReferral($invite)
	{
		$stream = Streams_Stream::fetch(
			null, $invite->publisherId, $invite->streamName
		);
		$c = $stream ? $stream->getAttribute('communityId', null) : null;
		if (!$c and Users::isCommunityId($invite->publisherId)) {
			$c = $invite->publisherId;
		}
		return $c;
	}

	function decline()
	{
		$invite = $this;
		$userId = $this->userId ? $this->userId : Users::loggedInUserId();
		if (self::stateFor($this, $userId) !== 'pending') {
			return false;
		}
		if (Q::event("Streams/invite/decline",
			@compact('invite', 'userId'), 'before') === false) {
			return false;
		}
		// Only a personal invite is resolved by one person declining. A general
		// link stays open -- declining is recorded against that person in
		// streams_invited, which is what stateFor() reads.
		if ($this->userId) {
			$this->state = 'declined';
			$this->save();
		}
		if ($userId) {
			$invited = new Streams_Invited();
			$invited->token = $this->token;
			$invited->userId = $userId;
			$invited->state = 'declined';
			$invited->save(true);
		}
		unset($_SESSION['Streams']['inviteFollowedToken']);
		Q::event("Streams/invite/decline",
			@compact('invite', 'userId'), 'after');
		return true;
	}

	/**
	 * The roles this invite is offering, resolved to displayable titles and icons.
	 * These are NOT granted until the invite is accepted, so anything showing them
	 * must stay future-tense.
	 *
	 * Reads the invite's "addLabel" extra against the stream publisher's labels.
	 * Also reads "addMyLabel" against the inviting user's labels, but only when
	 * the inviter is a community — for a person, those are their own private
	 * contact taxonomy rather than roles the invitee receives.
	 *
	 * Labels with no resolvable title are skipped rather than shown raw.
	 *
	 * @method rolesOffered
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {Streams_Stream} $stream
	 * @return {array} array of array('label' => ..., 'title' => ..., 'icon' => ...)
	 */
	/**
	 * Resolve a role spec to {label, title, icon} triples for display.
	 *
	 * Shared by community labels and participant roles so there is ONE
	 * presentation path. The two vocabularies are independent -- community
	 * labels come from users_label and Users/roles, participant roles from
	 * the Streams types config -- but the fallback chain and the
	 * icon resolution are identical, and a second copy of this would drift.
	 *
	 * Icons resolve the same way for both: a path string through
	 * Users::iconUrl(). The upload half of Users_Label (writing to
	 * Q/uploads/Users/$userId/label/...) has no participant analogue --
	 * participant role icons are declared in config, not uploaded per owner.
	 *
	 * @method presentRoles
	 * @static
	 * @protected
	 * @param {array|string} $spec A list of role names, or ($name => array($title, $icon))
	 * @param {string} [$ownerId=null] If set, look up users_label rows for this owner
	 * @param {array} [$config=null] Roles tree for title/icon fallback.
	 *   Defaults to the Users/roles config.
	 * @param {array} [$seen=array()] Names already emitted, passed by reference
	 * @return {array}
	 */
	protected static function presentRoles(
		$spec, $ownerId = null, $config = null, &$seen = array()
	) {
		if (empty($spec)) {
			return array();
		}
		if (is_string($spec)) {
			$spec = array_map('trim', explode("\t", $spec));
		}
		// may be a list of names, or ($name => array($title, $icon))
		$names = Q::isAssociative($spec) ? array_keys($spec) : $spec;
		$rows = $ownerId ? Users_Label::fetch($ownerId, $names) : array();

		$roles = array();
		foreach ($names as $name) {
			if (isset($seen[$name])) {
				continue;
			}
			$row = Q::ifset($rows, $name, null);

			$title = $row ? $row->title : null;
			if (!$title) {
				$title = isset($config)
					? Q::ifset($config, $name, 'title', null)
					: Q_Config::get('Users', 'roles', $name, 'title', null);
			}
			if (!$title and Q::isAssociative($spec)) {
				$title = Q::ifset($spec, $name, 0, null);
			}
			if (!$title) {
				continue; // nothing presentable -- don't show a raw role name
			}

			$icon = $row ? $row->icon : null;
			if (!$icon) {
				$icon = isset($config)
					? Q::ifset($config, $name, 'icon', null)
					: Q_Config::get('Users', 'roles', $name, 'icon', null);
			}
			if (!$icon and Q::isAssociative($spec)) {
				$icon = Q::ifset($spec, $name, 1, null);
			}
			if (!$icon) {
				$icon = 'labels/default';
			}

			$seen[$name] = true;
			$roles[] = array(
				'label' => $name,
				'title' => $title,
				'icon' => Users::iconUrl($icon, false)
			);
		}
		return $roles;
	}

	/**
	 * Community roles (users_label) this invite offers.
	 * @method rolesOffered
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {Streams_Stream} $stream
	 * @return {array}
	 */
	static function rolesOffered($invite, $stream)
	{
		$inviterId = $invite->invitingUserId;
		$labelSpecs = array(
			array($invite->getExtra('addLabel'), $stream->publisherId)
		);
		if (Users::isCommunityId($inviterId)) {
			$labelSpecs[] = array($invite->getExtra('addMyLabel'), $inviterId);
		}
		$roles = array();
		$seen = array();
		foreach ($labelSpecs as $labelSpec) {
			list($spec, $ownerId) = $labelSpec;
			$roles = array_merge(
				$roles, self::presentRoles($spec, $ownerId, null, $seen)
			);
		}
		return $roles;
	}

	/**
	 * Participant roles (streams_participant extra.role) this invite offers.
	 *
	 * Only roles declared for the stream's type are offered -- an undeclared
	 * name has no title and presentRoles() drops it, so a typo in extra
	 * silently shows nothing rather than offering a role that grants nothing.
	 *
	 * @method participantRolesOffered
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {Streams_Stream} $stream
	 * @return {array}
	 */
	static function participantRolesOffered($invite, $stream, $options = array())
	{
		$spec = $invite->getExtra('addParticipantRole');
		if (empty($spec)) {
			return array();
		}
		if (is_string($spec)) {
			$spec = array_map('trim', explode("\t", $spec));
		} else if (Q::isAssociative($spec)) {
			$spec = array_keys($spec);
		}
		$declared = Streams_Participant::rolesConfig($stream->type);
		$out = array();
		foreach ($spec as $role) {
			if (!isset($declared[$role])) {
				continue; // undeclared: offering it would grant nothing
			}
			$out[] = Streams_Participant::roleDisplay($stream->type, $role, $options);
		}
		return $out;
	}

	/**
	 * Builds the payload for the invited dialog, which the client reads from
	 * Q.plugins.Streams.invited.dialog: who invited you, the stream, whether
	 * your name is still missing, any roles being offered, plus whatever hooks
	 * add on the Streams/Dialogs/invite/complete event (Assets adds "discount").
	 *
	 * Called from two places, both of which already have the stream in hand:
	 * Streams_after_Q_objects for someone who was already logged in when they
	 * followed the link, and Streams_after_Users_setLoggedInUser for someone who
	 * logged in or registered afterward.
	 *
	 * @method dialogData
	 * @static
	 * @param {Streams_Invite} $invite
	 * @param {Streams_Stream} $stream The stream the invite is to
	 * @param {Users_User} [$user] The invited user, if one is logged in yet
	 * @return {array|null} null if there is nothing to show
	 */
	/**
	 * A value the server will only ever hand to a rendered invite dialog, and
	 * which the accept/decline handler requires.
	 *
	 * Without it, ANY request carrying Q.Streams.acceptInvite accepted the
	 * invite using the victim's cookie -- including a bare cross-site GET:
	 *
	 *   <img src="https://app/?Q.Streams.token=X&Q.Streams.acceptInvite=1">
	 *
	 * which defeated the whole point of asking for consent.
	 *
	 * It is derived rather than stored: an HMAC over the token and the current
	 * session id. That keeps it bound to one person's session and unforgeable
	 * without the app secret, with no session write to persist and no ordering
	 * dependency on when the dialog was rendered. Effectively a scoped
	 * capability, minus a second expiry and revocation path to keep in sync --
	 * the invite's own state machine already provides those.
	 *
	 * @method consentSignature
	 * @static
	 * @param {string} $token
	 * @return {string}
	 */
	static function consentSignature($token)
	{
		$secret = Q_Config::get('Q', 'internal', 'secret', null);
		if (!$secret) {
			$secret = Q_Config::expect('Q', 'app');
		}
		return hash_hmac('sha256', $token . '|' . Q_Session::id(), $secret);
	}

	static function dialogData($invite, $stream, $user = null)
	{
		// the invited dialog is rendered client-side from a template, so its
		// styles have to be requested here rather than by a view
		Q_Response::addStylesheet('{{Streams}}/css/tools/participantRoles.css', 'Streams');

		$consent = self::consentSignature($invite->token);
		$text = Q_Text::get('Streams/content');

		$nameIsMissing = true;
		$displayName = '';
		if ($user) {
			$displayName = $user->displayName(array('show' => 'flu'));
			$avatar = Streams_Avatar::fetch($user->id, $user->id);
			if (Q::ifset($avatar, 'username', null)
			or Q::ifset($avatar, 'firstName', null)
			or Q::ifset($avatar, 'lastName', null)) {
				$nameIsMissing = false;
			}
		}

		if ($invited = (new Streams_Invited(array(
			'userId' => $user ? $user->id : $invite->userId,
			'token' => $invite->token,
			'state' => 'accepted'
		)))->retrieve()) {
			return null;
		}

		$invitingUser = Users_User::fetch($invite->invitingUserId);
		if (!$invitingUser) {
			return null;
		}

		$relations = $related = array();
		if ($user) {
			list($relations, $related) = Streams::related(
				$user->id,
				$stream->publisherId,
				$stream->name,
				false
			);
		}

		$templateName = Streams_Stream::getConfigField(
			$stream->type,
			array('invited', 'dialog', 'templateName'),
			'Streams/templates/invited/complete'
		);

		$invitedToProfile = ($stream->name === 'Streams/user/profile');
		$textKey = $invitedToProfile
			? 'HasInvitedYouToTheirProfile'
			: 'HasInvitedYou';

		$params = array(
			'displayName' => $displayName,
			'nameIsMissing' => $nameIsMissing,
			'action' => 'Streams/basic',
			'icon' => $user ? $user->iconUrl(false) : null,
			'token' => $invite->token,
			'invitingUser' => array(
				'id' => $invitingUser->id,
				'icon' => $invitingUser->iconUrl(false),
				'displayName' => $invitingUser->displayName(array(
					'fullAccess' => true,
					'show' => 'flu'
				)),
				'text' => Q::interpolate(
					$text['invite']['complete'][$textKey],
					array('title' => $stream->title)
				)
			),
			'showStreamPreview' => !$invitedToProfile,
			'templateName' => $templateName,
			'stream' => $stream->exportArray(),
			'relations' => !empty($relations) ? Db::exportArray($relations) : array(),
			'related' => !empty($related) ? Db::exportArray($related) : array()
		);

		$params['consent'] = $consent;
		if ($roles = self::rolesOffered($invite, $stream)) {
			$params['roles'] = $roles;
			$params['rolesPrompt'] = Q::ifset(
				$text, 'invite', 'complete', 'RolesOffered',
				"Roles you're being offered:"
			);
		}
		if ($proles = self::participantRolesOffered($invite, $stream)) {
			// kept as a separate key from 'roles': these are a different
			// vocabulary, stored in streams_participant rather than
			// users_label, and rendered with an emoji rather than an icon
			$params['participantRoles'] = $proles;
			$params['participantRolesPrompt'] = Q::interpolate(
				Q::ifset(
					$text, 'invite', 'complete', 'ParticipantRolesOffered',
					"Your role in this {{streamDisplayType}}:"
				),
				array('streamDisplayType' => Streams_Stream::displayType($stream->type))
			);
		}

		// Hooks add to the payload here. Assets uses this to add "discount",
		// so this must stay inside dialogData rather than at the call sites,
		// or the discount silently disappears on one of the two paths.
		$referrerUserId = $invite->invitingUserId;
		$params = Q::event('Streams/Dialogs/invite/complete', compact(
			'stream', 'user', 'referrerUserId', 'invite'
		), 'before', false, $params);

		if (Users::isCommunityId($stream->publisherId)) {
			$params['communityId'] = $stream->publisherId;
			$params['communityName'] = Streams::displayName($stream->publisherId);
		}

		// merge over any Streams/types/<type>/invited/dialog defaults,
		// which is where things like "delay" come from
		$config = Streams_Stream::getConfigField($stream->type, 'invited', array());
		$defaults = Q::ifset($config, 'dialog', array());
		$tree = new Q_Tree($defaults);
		if (!$tree->merge($params)) {
			return null;
		}
		$dialogData = $tree->getAll();
		return $dialogData ? $dialogData : null;
	}
	
	static protected $cache = array();

	/**
	 * @property $followedInvite
	 * @type Streams_Invite
	 */
	static $followed = null;

	/* * * */
	/**
	 * Implements the __set_state method, so it can work with
	 * with var_export and be re-imported successfully.
	 * @method __set_state
	 * @param {array} $array
	 * @return {Streams_Invite} Class instance
	 */
	static function __set_state(array $array) {
		$result = new Streams_Invite();
		foreach($array as $k => $v)
			$result->$k = $v;
		return $result;
	}
};
