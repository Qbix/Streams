<?php

function Users_unsubscribe_response()
{
    if (!Users::loggedInUser()) {
        $address = Q::ifset($_REQUEST, 'e', '');
        $authCode = Q::ifset($_REQUEST, 'authCode', '');
        $email = new Users_Email(compact("address"));
        if ($email->retrieve() and $email->authCode === $authCode) {
            Users::setLoggedInUser($email->userId);
        }
    }
	Q_Response::redirect('Streams/participating');
    return true;
}