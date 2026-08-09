<?php

function Streams_after_Q_objects ()
{
	$uri = Q_Dispatcher::uri();
	if ($uri->module === 'Users' and $uri->action === 'unsubscribe') {
		if (!Users::loggedInUser()) {
			// Do NOT log them in. An unsubscribe link ends up in forwarded
			// mail, screenshots, browser history and mail-client prefetches;
			// granting a full session to whoever holds one made it a
			// password-equivalent. Users_Unsubscribe issues a grant scoped to
			// the single identifier the link names, which expires on its own.
			// It also accepts every parameter spelling the codebase
			// generates -- the reader here only understood "e", while
			// Users/Email.php emits "emailAddress", Users/Mobile.php emits
			// "mobileNumber" and views/Users/email/addEmail.php emits "code",
			// so logged-out unsubscribe silently did nothing for those. And
			// it handles mobile as well as email, which this never did.
			Users_Unsubscribe::fromRequest();
		}
	}
	$invite = Streams_Invite::$followed;
	if (!$invite) {
		return;
	}
	if (filter_var($invite->getExtra('dontAutoLogin'), FILTER_VALIDATE_BOOLEAN)) {
		return;
	}

	$stream = new Streams_Stream();
	$stream->publisherId = $invite->publisherId;
	$stream->name = $invite->streamName;
	if (!$stream->retrieve()) {
		throw new Q_Exception_MissingRow(array(
			'table' => 'stream',
			'criteria' => 'with that name'
		), 'streamName');
	}

	$user = Users::loggedInUser();

	// Someone who was already logged in when they followed the link never
	// triggers Users::setLoggedInUser, so Streams_after_Users_setLoggedInUser
	// never ran for them. Do its work here instead, for the invites that
	// qualify for auto-accept. The state check keeps this from redoing what
	// that handler already did on requests where the invite logged them in.
	// per-user, not the shared column: a general link stays pending for
	// everyone who hasn't personally resolved it
	$stateForUser = Streams_Invite::stateFor($invite, $user ? $user->id : null);
	if ($user and $stateForUser === 'pending'
	and Streams_Invite::shouldAutoAccept($invite, $stream, $user)) {
		$invite->accept(array('access' => true, 'subscribe' => true));
		Streams::inviteResolved($invite, $stream, $user, true);
		return;
	}

	// Everything below only runs for invites that need explicit consent.
	// A resolved invite must not be offered again: without this, re-following
	// a declined or expired link showed the Accept dialog a second time.
	// Per-user -- reading the shared column here meant the first person to
	// accept a general link stopped the dialog appearing for everybody else.
	if ($stateForUser !== 'pending') {
		return;
	}
	$showDialog = true;
	$displayName = $user ? $user->displayName(array('show' => 'flu')) : '';
	$p = @compact('user', 'invite', 'displayName', 'stream');
	Q::event('Streams/inviteDialog', $p, 'before', false, $showDialog);
	if (!$showDialog) {
		return;
	}

	if ($dialogData = Streams_Invite::dialogData($invite, $stream, $user)) {
		Q_Response::setScriptData('Q.plugins.Streams.invited.dialog', $dialogData);
		Q_Response::addTemplate(Q::ifset(
			$dialogData, 'templateName', 'Streams/templates/invited/complete'
		));
	}
}
