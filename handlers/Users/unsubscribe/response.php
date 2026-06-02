<?php

function Users_unsubscribe_response()
{
	Q_Response::redirect('Streams/participating');
    return true;
}