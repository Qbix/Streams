<?php

function Streams_before_Users_referred($params, &$result)
{
    if (!empty($result['byUserId'])) {
        return;
    }
    // since byUserId is not already set, use invitingUserId if this session came from invite
    if ($token = Q::ifset($_SESSION, 'Streams', 'invite', 'token', null)) {
        // this works if the session was already opened
        if ($invite = Streams_Invite::fromToken($token)) {
            $result['byUserId'] = $invite->invitingUserId; // reward referrer to this session
        }
    }
}