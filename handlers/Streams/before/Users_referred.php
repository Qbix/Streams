<?php

function Streams_before_Users_referred($params, $result)
{
    if ($result) {
        return; // byUserId already set
    }
    if ($token = Q::ifset($_SESSION, 'Streams', 'invite', 'token', null)) {
        // this works if the session was already opened
        if ($invite = Streams_Invite::fromToken($token)) {
            $result = $invite->invitingUserId; // reward referrer to this session
        }
    }
}