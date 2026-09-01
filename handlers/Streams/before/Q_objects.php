<?php

function Streams_before_Q_objects()
{
	$token = Q_Request::special('Streams.token', null);
	if ($token === null) {
		Streams_before_Q_objects_handle_inviteResponse();
		$field = Q_Config::get('Streams', 'token', 'field', null);
		$token = Q::ifset($_REQUEST, $field, null);
		if (!$token) {
			return;
		}
	}
	
	static $alreadyExecuted = false;
	if ($alreadyExecuted) {
		return; // this can happen during e.g. Q_Response::forward()
	}
	$alreadyExecuted = true;

	$invite = Streams_Invite::fromToken($token, true);
	
	// did invite expire?
	$ts = Streams_Invite::db()->select("CURRENT_TIMESTAMP")->fetchAll(PDO::FETCH_NUM);
	if (isset($invite->expireTime)
	and $invite->expireTime < $ts[0][0]) {
		$invite->state = 'expired';
		$invite->save();
	}
	
	// retain the invite object for further processing
	Streams_Invite::$followed = $invite;
	
	// is invite still pending?
	if ($invite->state !== 'pending') {
		$exception = null;
		switch ($invite->state) {
		case 'accepted':
			break;
		case 'expired':
			$exception = new Streams_Exception_AlreadyExpired(null, 'token');
			break;
		case 'declined':
			$exception = new Streams_Exception_AlreadyDeclined(null, 'token');
			break;
		case 'forwarded':
			$exception = new Streams_Exception_AlreadyForwarded(null, 'token');
			break;
		case 'claimed':
			$exception = new Streams_Exception_AlreadyClaimed(null, 'token');
			break;
		default:
			$exception = new Q_Exception("This invite has already been " . $invite->state, 'token');
			break;
		}
		if ($exception) {
			$shouldThrow = Q::event('Streams/objects/inviteException', 
				@compact('invite', 'exception'), 'before'
			);
			if ($shouldThrow === null) {
				Q_Response::setNotice('Streams/objects', $exception->getMessage());
			} else if ($shouldThrow === true) {
				throw $exception;
			}
		}
	}
	
	// INVITE: now that user may have logged in (or still not)
	// save the token for Streams_Invite::$followed in the session
	$_SESSION['Streams']['inviteFollowedToken'] = $invite->token;

	// user just landed on a page, don't expect nonce from client
	Q_Session::setNonce();
	$liu = Users::loggedInUser();	
	if (!$liu and $invite->userId) {
		// invite was for a speciic user, and 
		// log the invited user in only if they weren't logged in before
		$user = new Users_User();
		$user->id = $invite->userId;
		if (!$user->retrieve()) {
			// The user who was invited doesn't exist
			// This shouldn't happen. We just silently log it and return.
			Q::log("Sanity check failed: invite with {$invite->token} pointed to nonexistent user");
			return;
		}
		Users::setLoggedInUser($user);
	}
	
	if (!$liu and !$invite->userId) {
		// tell Users plugin we have an icon ready for a certain user
		// based on the invite token, once we actually setLoggedInUser
		// and they didn't have a custom icon yet, the system might use this.
		$splitId = Q_Utils::splitId($invite->invitingUserId, 3, "/");
		$path = 'Q/uploads/Users';
		$subpath = $splitId.'/invited/'.$token;
		$pathToToken = APP_DIR.'/web/'.$path.'/'.$subpath;
		Q_Utils::normalizePath($pathToToken);
		if (file_exists($pathToToken)) {
			$_SESSION['Users']['register']['icon'] = Q_Html::themedUrl(
				$path.DS.$subpath,
				array("baseUrlPlaceholder" => true)
			);
		}
	}

	Streams_before_Q_objects_handle_inviteResponse(); 
}

/**
 * Handles an explicit Accept or Decline of the invite that was followed
 * in this session. The client signals which one via the special fields
 * Q.Streams.acceptInvite or Q.Streams.declineInvite.
 *
 * This is the *explicit consent* path -- the person clicked a button --
 * so it deliberately does NOT consult Streams_Invite::shouldAutoAccept().
 * That function only decides whether we may skip asking at all.
 */
function Streams_before_Q_objects_handle_inviteResponse()
{
	$accept = Q_Request::special('Streams.acceptInvite');
	$decline = Q_Request::special('Streams.declineInvite');
	if (!$accept and !$decline) {
		return;
	}

	// Prefer the session, but fall back to the token the form posts. The
	// session copy is written while handling a followed invite link, and this
	// handler runs BEFORE that happens on the request that carries the click --
	// so relying on the session alone left the invite pending after Accept.
	// The token is itself the credential, which is why it is safe to trust here.
	$token = Q::ifset($_SESSION, 'Streams', 'inviteFollowedToken', null);
	if (!$token) {
		$token = Q::ifset($_REQUEST, 'token', null);
	}
	if (!$token) {
		return;
	}

	$invite = Streams_Invite::fromToken($token);
	if (!$invite) {
		return;
	}

	$user = Users::loggedInUser();
	if (!$user) {
		// nobody to accept or decline on behalf of; leave the token parked
		// so Streams_after_Users_setLoggedInUser can ask again after login
		return;
	}

	// Require the value dialogData() handed to the rendered dialog. Without
	// this, ANY request carrying Q.Streams.acceptInvite accepted the invite
	// using the victim's cookie -- including a bare cross-site GET:
	//   <img src="https://app/?Q.Streams.token=X&Q.Streams.acceptInvite=1">
	// which defeated the whole point of asking for consent.
	//
	// This has to come AFTER loggedInUser(): the signature is bound to the
	// session id, and no session exists this early in Q/objects -- checking
	// sooner compares against an HMAC over an empty session id and never
	// matches.
	$consent = Q_Request::special('Streams.inviteConsent');
	if (!$consent
	or !hash_equals(Streams_Invite::consentSignature($token), (string)$consent)) {
		return;
	}

	// per-user: a general link one person already accepted is still pending
	// for this person, and must remain actionable
	if (Streams_Invite::stateFor($invite, $user->id) !== 'pending') {
		return;
	}

	// Fetch WITHOUT access filtering. The invited user usually has no read
	// access yet -- granting it is what accept() is about -- so fetching as
	// them returns null and this used to throw MissingRow, silently leaving
	// the invite pending after the user clicked Accept.
	$stream = Streams_Stream::fetch(
		null, $invite->publisherId, $invite->streamName
	);
	if (!$stream) {
		throw new Q_Exception_MissingRow(array(
			'table' => 'stream',
			'criteria' => 'with that name'
		), 'streamName');
	}

	if ($decline) {
		$invite->decline();
		return;
	}

	$invite->accept(array(
		'access' => true,
		'subscribe' => true
	));
}

/**
 * Kept for backward compatibility with any app code that called it directly.
 * @deprecated use Streams_before_Q_objects_handle_inviteResponse()
 */
function Streams_before_Q_objects_handle_acceptInvite()
{
	return Streams_before_Q_objects_handle_inviteResponse();
}
