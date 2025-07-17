<?php
	
function Streams_after_Users_setLoggedInUser($params)
{
	$user = $params['user'];
	$invite = null;
	if ($token = Q::ifset($_SESSION, 'Streams', 'invite', 'token', null)) {
		$invite = Streams_Invite::fromToken($token);
		// accept invite and autosubscribe if first time and possible
		if ($invite and $invite->accept(array(
			'access' => true,
			'subscribe' => true
		))) {
			$splitId = Q_Utils::splitId($invite->invitingUserId, 3, "/");
			$path = 'Q/uploads/Users';
			$subpath = $splitId.'/invited/'.$token;
			$pathToToken = APP_DIR.'/web/'.$path.'/'.$subpath;
			Q_Utils::normalizePath($pathToToken);
			if (file_exists($pathToToken) && !Users::isCustomIcon($user->icon)) {
				$user->icon = Q_Html::themedUrl("$path/$subpath", array("baseUrlPlaceholder" => true));
				$user->save();
			}
		}
	}

	// if this the first time the user has ever logged in,
	// subscribe to main community announcements
	if ($user->sessionCount <= 1) {
		$communityId = Users::communityId();
		$stream = Streams_Stream::fetch($user->id, $communityId, 'Streams/experience/main');
		if ($stream and !$stream->subscription($user->id)) {
			$stream->subscribe();
		}
	}

}