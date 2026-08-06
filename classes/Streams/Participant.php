<?php
/**
 * @module Streams
 */
/**
 * Class representing 'Participant' rows in the 'Streams' database
 * You can create an object of this class either to
 * access its non-static methods, or to actually
 * represent a participant row in the Streams database.
 *
 * @class Streams_Participant
 * @extends Base_Streams_Participant
 */
class Streams_Participant extends Base_Streams_Participant
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
	 * Get an array of users participating in the stream
	 * @method getUsers
	 * @param {string} $publisherId
	 * @param {string} $streamName
	 * @param {array} [$options=array()] Options to pass to the Db_Query->options method
	 * @return {array}
	 *	An array of user ids 
	 */
	static function getUserIds($publisherId, $streamName, $options = array()) {
		$q = Streams_Participant::select('userId')
			->where(array(
				'publisherId' => $publisherId,
				'streamName' => $streamName
			));
		if ($options) {
			$q->options($options);
		}
		return $q->fetchAll(PDO::FETCH_COLUMN, 0);
	}

	/**
	 * Filter to just the ids of users which are, or are not, participating in a stream
	 * @method filter
	 * @static
	 * @param {array} $userIds An array of user ids to filter
	 * @param {string} $publisherId The id of the publisher of the stream
	 * @param {string} $streamName The name of the stream
	 * @param {string|array|null} $state can be "invited", "participating", "left", or an array, or null.
	 *  If null, then it will return any
	 * @return {array}
	 */
	static function filter($userIds, $publisherId, $streamName, $state = null) {
		$criteria = array(
			'publisherId' => $publisherId,
			'streamName' => $streamName,
			'userId' => $userIds
		);
		if (isset($state)) {
			$criteria['state'] = $state;
		}
		return Streams_Participant::select('userId')
			->where($criteria)
			->fetchAll(PDO::FETCH_COLUMN, 0);
	}

	/**
	 * Convert participant object to array safe to show to a user
	 * @method exportArray()
	 * @param {array} $options=null
	 * @return {array}
	 */
	function exportArray($options = null) {
		return $this->toArray();
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
	 * @return Streams_Participant
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
	 * Test whether participant has one or more roles in stream
	 * @method testRoles
	 * @param {string|array} $roles You can pass a role name, or array of role names
	 * @return {boolean} whether the user has all the roles
	 */
	/**
	 * The declared participant-role vocabulary for a stream type.
	 *
	 * Deliberately the SAME SHAPE as Users/roles -- title, icon, canGrant,
	 * canRevoke, canSee -- so it can be handed straight to
	 * Users_Label::operateLabelAction() instead of growing a second
	 * grantability engine that would drift from the first one. The vocabularies
	 * are independent; only the shape and the engine are shared.
	 *
	 * Type-specific roles are merged over the ones declared under "*", the same
	 * fallback the rest of Streams uses via getConfigField().
	 *
	 * @method rolesConfig
	 * @static
	 * @param {string} $streamType
	 * @return {array}
	 */
	static function rolesConfig($streamType)
	{
		$all = Q_Config::get('Streams', 'types', '*', 'participant', 'roles', array());
		$specific = Streams_Stream::getConfigField(
			$streamType, array('participant', 'roles'), array()
		);
		$merged = array_merge($all, is_array($specific) ? $specific : array());
		// Participant roles are simple strings with no slash. The slash is
		// load-bearing elsewhere -- it routes the Q_Text lookup for community
		// labels and for stream types -- so keeping it out here is what makes
		// "has a slash" mean "community label" and nothing else.
		foreach (array_keys($merged) as $role) {
			if (strpos($role, '/') !== false) {
				unset($merged[$role]);
				Q::log("Streams_Participant::rolesConfig: ignoring '$role' for "
					. "$streamType -- participant roles must not contain '/'");
			}
		}
		return $merged;
	}

	/**
	 * Title and emoji for a participant role, in the viewer's language.
	 *
	 * Unlike community labels -- whose titles are resolved once at addLabel()
	 * time and stored in users_label.title, so they stay in whatever language
	 * the creator was using -- these resolve on every read, so they follow the
	 * viewer. Same mechanism stream types use in Streams_Stream::displayType().
	 *
	 * Lookup order: the type-keyed text entry, then the config title, then
	 * ucfirst of the role name so nothing ever renders blank.
	 *
	 * Emoji rather than icon is deliberate: no upload path, no size variants,
	 * no {{baseUrl}} interpolation, and it reads differently at a glance from
	 * the icon-bearing community labels.
	 *
	 * @method roleDisplay
	 * @static
	 * @param {string} $streamType
	 * @param {string} $role
	 * @param {array} [$options=array()] Passed to Q_Text::get (language, locale)
	 * @return {array} Has "role", "title" and "emoji"
	 */
	static function roleDisplay($streamType, $role, $options = array())
	{
		$config = self::rolesConfig($streamType);
		$spec = Q::ifset($config, $role, array());

		$title = null;
		try {
			$parts = explode('/', $streamType);
			$module = reset($parts);
			$text = Q_Text::get("$module/content", array_merge(
				array('dontThrow' => true), $options
			));
			$title = Q::ifset(
				$text, 'participant', 'roles', $streamType, $role, null
			);
			if (!$title) {
				// roles shared across types can be declared once under "*"
				$title = Q::ifset($text, 'participant', 'roles', '*', $role, null);
			}
		} catch (Exception $e) {
			// the text file may not exist; fall through
		}
		if (!$title) {
			$title = Q::ifset($spec, 'title', null);
		}
		if (!$title) {
			$title = ucfirst($role);
		}
		return array(
			'role' => $role,
			'title' => $title,
			'emoji' => Q::ifset($spec, 'emoji', '')
		);
	}

	/**
	 * Whether someone holding $granterRoles may perform $actionKey on $roles.
	 * All three of canGrantRoles/canRevokeRoles/canSeeRoles route through here,
	 * which routes through the same engine that governs community labels.
	 * @method operateRoles
	 * @static
	 * @protected
	 */
	protected static function operateRoles($streamType, $granterRoles, $roles, $actionKey)
	{
		if (empty($roles)) {
			return true; // nothing being asked for
		}
		$config = self::rolesConfig($streamType);
		if (empty($config)) {
			return false; // no vocabulary declared: nothing is grantable
		}
		foreach ((array)$granterRoles as $granterRole) {
			if (Users_Label::operateLabelAction($granterRole, $roles, $actionKey, $config)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * @method canGrantRoles
	 * @static
	 * @param {string} $streamType
	 * @param {string|array} $granterRoles Roles the granter already holds
	 * @param {string|array} $roles Roles they want to grant
	 * @return {boolean}
	 */
	static function canGrantRoles($streamType, $granterRoles, $roles)
	{
		return self::operateRoles($streamType, $granterRoles, $roles, 'canGrant');
	}

	/**
	 * @method canRevokeRoles
	 * @static
	 * @return {boolean}
	 */
	static function canRevokeRoles($streamType, $granterRoles, $roles)
	{
		return self::operateRoles($streamType, $granterRoles, $roles, 'canRevoke');
	}

	/**
	 * @method canSeeRoles
	 * @static
	 * @return {boolean}
	 */
	static function canSeeRoles($streamType, $granterRoles, $roles)
	{
		return self::operateRoles($streamType, $granterRoles, $roles, 'canSee');
	}

	/**
	 * Which participant roles this user may grant, revoke and see on a stream.
	 *
	 * Returns the same shape as Users_Label::can() so a UI can consume either
	 * without special-casing. The fetch differs -- participant roles live on
	 * streams_participant keyed by (publisherId, streamName, userId) rather
	 * than on users_contact -- so only the filtering is shared, not the lookup.
	 *
	 * A publisher, or anyone with adminLevel >= 'manage' on the stream, is not
	 * required to hold a role themselves: the bypass sits ABOVE the role check
	 * because operateLabelAction() returns false for a granter holding no role.
	 *
	 * @method can
	 * @static
	 * @param {string} $publisherId
	 * @param {string} $streamName
	 * @param {string} [$userId=null] Defaults to the logged-in user.
	 * @return {array} Contains "grant", "revoke", "see" arrays of role names,
	 *   plus "roles" (the declared vocabulary) and "isAdmin".
	 */
	static function can($publisherId, $streamName, $userId = null)
	{
		if (!isset($userId)) {
			$user = Users::loggedInUser(false, false);
			$userId = $user ? $user->id : '';
		}
		// Fetch without access filtering: the stream's TYPE is what selects the
		// role vocabulary, and a granter who can't read the stream would
		// otherwise get an empty vocabulary rather than an honest "no".
		// Access is still enforced below, via testAdminLevel.
		$stream = Streams_Stream::fetch(null, $publisherId, $streamName);
		$streamType = $stream ? $stream->type : '';
		$config = self::rolesConfig($streamType);
		$all = array_keys($config);

		$isAdmin = ($userId and $userId === $publisherId);
		if (!$isAdmin and $stream and $userId) {
			// re-fetch as the user, so admin level reflects THEIR access
			$asThem = Streams_Stream::fetch($userId, $publisherId, $streamName);
			$isAdmin = $asThem ? $asThem->testAdminLevel('manage') : false;
		}
		if ($isAdmin) {
			// publisher and stream admins are not required to hold a role
			$result = array(
				'grant' => $all, 'revoke' => $all, 'see' => $all,
				'roles' => $config, 'isAdmin' => true
			);
		} else {
			$p = new Streams_Participant(@compact('publisherId', 'streamName', 'userId'));
			$mine = $p->retrieve() ? $p->getExtra('role', array()) : array();
			if (is_string($mine)) {
				$mine = array($mine);
			} else if (Q::isAssociative($mine)) {
				$mine = array_keys($mine);
			}
			$result = array(
				'grant' => array(), 'revoke' => array(), 'see' => array(),
				'roles' => $config, 'isAdmin' => false
			);
			foreach ($all as $role) {
				foreach (array('grant' => 'canGrant', 'revoke' => 'canRevoke', 'see' => 'canSee') as $k => $actionKey) {
					if (self::operateRoles($streamType, $mine, $role, $actionKey)) {
						$result[$k][] = $role;
					}
				}
			}
		}

		/**
		 * Lets an app widen or narrow what a user may do with participant roles.
		 * @event Streams/Participant/can {after}
		 */
		Q::event('Streams/Participant/can',
			@compact('publisherId', 'streamName', 'userId', 'streamType'),
			'after', false, $result
		);
		return $result;
	}

	function testRoles ($roles) {
		$extraRoles = $this->getExtra('role', array());
		if (empty($extraRoles) || empty($roles)) {
			return false;
		}
		if (is_string($extraRoles)) {
			$extraRoles = array($extraRoles);
		} else if (Q::isAssociative($extraRoles)) {
			$extraRoles = array_keys($extraRoles);
		}
		if (is_string($roles)) {
			$roles = array($roles);
		}
		foreach ($roles as $role) {
			if (!in_array($role, $extraRoles, true)) {
				return false;
			}
		}
		return true;
	}

	/**
	 * @method grantRoles
	 * @param {string|array} $roles
	 * @return Streams_Participant
	 */
	/**
	 * @param {string|array} $roles
	 * @param {string} [$asUserId=null] When set, the grant is checked against
	 *   what this user is allowed to grant on this stream type. Left null --
	 *   the default, and what every pre-existing caller does -- the grant is
	 *   unchecked, which is correct for handlers acting as the system.
	 */
	function grantRoles($roles, $asUserId = null) {
		if (empty($roles)) {
			return $this;
		}
		if (isset($asUserId)) {
			$can = self::can($this->publisherId, $this->streamName, $asUserId);
			foreach ((array)$roles as $role) {
				if (!in_array($role, $can['grant'])) {
					throw new Users_Exception_NotAuthorized();
				}
			}
		}
		$extraRoles = $this->getExtra('role', array());
		if (is_string($roles)) {
			$roles = array($roles);
		}
		if (is_string($extraRoles)) {
			$extraRoles = array($extraRoles);
		}
		foreach ($roles as $v) {
			if (in_array($v, $extraRoles)) {
				continue;
			}
			$extraRoles[] = $v;
		}
		$this->setExtra('role', array_values($extraRoles));
		return $this;
	}

	/**
	 * @method revokeRoles
	 * @param {string|array} $roles
	 * @return Streams_Participant
	 */
	/**
	 * @param {string|array} $roles
	 * @param {string} [$asUserId=null] See grantRoles().
	 */
	function revokeRoles($roles, $asUserId = null) {
		$extraRoles = $this->getExtra('role', array());
		if (empty($extraRoles) || empty($roles)) {
			return $this;
		}
		if (isset($asUserId)) {
			$can = self::can($this->publisherId, $this->streamName, $asUserId);
			foreach ((array)$roles as $role) {
				if (!in_array($role, $can['revoke'])) {
					throw new Users_Exception_NotAuthorized();
				}
			}
		}
		if (is_string($roles)) {
			$roles = array($roles);
		}
		if (is_string($extraRoles)) {
			$extraRoles = array($extraRoles);
		}
		foreach ($roles as $v) {
			if (($i = array_search($v, $extraRoles)) !== false) {
				unset($extraRoles[$i]);
			}
		}
		if (empty($extraRoles)) {
			$this->clearExtra('role');
		} else {
			$this->setExtra('role', array_values($extraRoles));
		}
		return $this;
	}

	/**
	 * @method beforeSave
	 * @param {array} $modifiedFields
	 *	The fields that were modified
	 * @return {array}
	 */
	function beforeSave($modifiedFields)
	{
		if (empty($this->extra)) {
			$this->extra = '{}';
		}
		foreach ($this->fields as $name => $value) {
			if (!empty($this->fieldsModified[$name])) {
				$modifiedFields[$name] = $value;
			}
		}
		return parent::beforeSave($modifiedFields);
	}
	
	/**
	 * @method afterSaveExecute
	 * @param {Db_Result} $result
	 * @param {Db_Query} $query
	 * @return {Db_Result}
	 */
	function afterSaveExecute($result, $query, $modifiedFields, $where)
	{
		if ($this->state !== 'participating') {
			return $result;
		}
		// Update the relations if something changed
		$participatingNames = Streams_Stream::getConfigField(
			$this->streamType, array('participating'), array()
		);
		if ($participatingNames
		and $this->wasRetrieved()
		and !empty($modifiedFields['extra'])) {
			Streams_RelatedTo::update()->set(array(
				'extra' => $this->extra
			))->where(array(
				'toPublisherId' => $this->userId,
				'toStreamName' => $participatingNames,
				'fromPublisherId' => $this->publisherId,
				'fromStreamName' => $this->streamName
			))->execute();
		}
		return $result;
	}

	
	/**
	 * Get the names of the possible states
	 * @method states
	 * @static
	 * @return {array}
	 */
	static function states()
	{
		$column = Base_Streams_Participant::column_state();
		return Q::json_decode(str_replace("'", '"',  '['.$column[0][1].']'));
	}

	/* * * */
	/**
	 * Implements the __set_state method, so it can work with
	 * with var_export and be re-imported successfully.
	 * @method __set_state
	 * @param {array} $array
	 * @return {Streams_Participant} Class instance
	 */
	static function __set_state(array $array) {
		$result = new Streams_Participant();
		foreach($array as $k => $v)
			$result->$k = $v;
		return $result;
	}
};
