<?php

function Streams_before_Users_register($params)
{
	Streams_Stream::begin()->execute();
}