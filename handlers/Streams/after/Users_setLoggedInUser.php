<?php
	
function Streams_after_Users_setLoggedInUser($params)
{
	$user = $params['user'];
	if ($token = Q::ifset($_SESSION, 'Streams', 'inviteFollowedToken', null)) {
		$invite = Streams_Invite::fromToken($token);
		if ($invite) {
			$stream = Streams_Stream::fetch(
				$user->id, $invite->publisherId, $invite->streamName
			);
			if ($stream) {
				if (Streams_Invite::needsExplicitConsent($invite, $stream)) {
					// Hand it back to the client instead of accepting: this one
					// needs the user to say yes. login.js runs
					// Q.Response.processScriptDataAndLines() on the response, so
					// this lands before its onActivated handler fires.
					if ($dialogData = Streams_Invite::dialogData($invite, $stream, $user)) {
						Q_Response::setScriptData(
							'Q.plugins.Streams.invited.dialog', $dialogData
						);
						Q_Response::addTemplate(Q::ifset(
							$dialogData, 'templateName',
							'Streams/templates/invited/complete'
						));
					}
				} else if ($invite->accept(array(
					'access' => true,
					'subscribe' => true
				))) {
					// accepted invite and autosubscribed. Now adopt the icon that
					// was generated for this invite, unless they have a custom one
					$splitId = Q_Utils::splitId($invite->invitingUserId, 3, "/");
					$path = 'Q/uploads/Users';
					$subpath = $splitId.'/invited/'.$token;
					$pathToToken = APP_DIR.'/web/'.$path.'/'.$subpath;
					Q_Utils::normalizePath($pathToToken);
					if (file_exists($pathToToken) && !Users::isCustomIcon($user->icon)) {
						$user->icon = Q_Html::themedUrl("$path/$subpath", array(
							"baseUrlPlaceholder" => true
						));
						$user->save();
					}
				}
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