<?php

function Streams_avatar_response()
{
	$prefix = $userIds = $batch = $public = $communities = $platform = null;
	$limit = 10;
	extract($_REQUEST, EXTR_IF_EXISTS);
	$user = Users::loggedInUser();
	$asUserId = $user ? $user->id : "";

	if (isset($prefix)) {
		// Prefix search enumerates the user base -- $limit avatars at a time,
		// each with first name, last name and username -- so it needs a
		// session. The old condition did the opposite: `$prefix or !$asUserId`
		// routed a logged-OUT caller into fetchByPrefix() even with an empty
		// prefix, which returns the directory itself. Its in-tree callers
		// (Streams/userChooser, the invite dialogs) all require a session
		// already.
		if (!$asUserId) {
			throw new Users_Exception_NotLoggedIn();
		}
		$options = @compact('limit', 'public', 'communities', 'platform');
		if ($prefix) {
			$avatars = Streams_Avatar::fetchByPrefix(
				$asUserId, 
				$prefix, 
				$options
			);
		} else {
			$userIds = Users_Contact::fetchUserIds($options);
			$avatars = Streams_Avatar::fetch($asUserId, $userIds);
			$count = count($userIds);
			if ($count < $limit) {
				$limit = $limit - $count;
				$moreAvatars = Streams_Avatar::fetchByPrefix(
					$asUserId, 
					$prefix, 
					$options
				);
				$avatars = array_merge($avatars, $moreAvatars);
			}
		}
	} else {
		if (isset($batch)) {
			$batch = json_decode($batch, true);
			if (!isset($batch)) {
				throw new Q_Exception_WrongValue(array('field' => 'batch', 'range' => '{userIds: [userId1, userId2, ...]}'));
			}
			if (!isset($batch['userIds'])) {
				throw new Q_Exception_RequiredField(array('field' => 'userIds'));
			}
			$userIds = $batch['userIds'];
		}
		if (!isset($userIds)) {
			throw new Q_Exception_RequiredField(array('field' => 'userIds'));
		}
		if (is_string($userIds)) {
			$userIds = explode(",", $userIds);
		}
		$avatars = Streams_Avatar::fetch($asUserId, $userIds);
	}

	$avatars = Db::exportArray($avatars);
	if (isset($batch)) {
		$result = array();
		foreach ($userIds as $userId) {
			$result[] = array('slots' =>
				array('avatar' => isset($avatars[$userId]) ? $avatars[$userId] : null)
			);
		}
		Q_Response::setSlot('batch', $result);
	} else {
		Q_Response::setSlot('avatars', $avatars);
	}
	return $avatars;
}