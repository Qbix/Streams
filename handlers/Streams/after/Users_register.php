<?php

function Streams_after_Users_register($params)
{
	Streams_Stream::commit()->execute();
}