<?php
function Streams_answer_put ($params) {
	$user = Users::loggedInUser(true);
	Q_Valid::nonce(true);

	$request = array_merge($_REQUEST, $params);
	$content = Q::ifset($request, "content", null);
	$text = Q_Text::get('Streams/content')['questions'];

	$publisherId = Streams::requestedPublisherId(true);
	$streamName = Streams::requestedName(true);
	$answerStream = Streams_Stream::fetch($user->id, $publisherId, $streamName);
	if (!$answerStream) {
		throw new Q_Exception_MissingRow(array(
			'table'    => 'stream',
			'criteria' => 'with that name'
		));
	}
	if (!$answerStream->testWriteLevel("join")) {
		throw new Users_Exception_NotAuthorized();
	}

	// check cantChangeAnswers option
	$questionStream = Streams_RelatedTo::select()->where(array(
		"fromPublisherId" => $publisherId,
		"fromStreamName" => $streamName,
		"type" => "Streams/answers"
	))->fetchDbRow();
	if (empty($questionStream)) {
		throw new Streams_Exception_NoSuchStream();
	}
	$questionStream = Streams::fetchOne(null, $questionStream->toPublisherId, $questionStream->toStreamName, true);
	if ($questionStream->getAttribute("cantChangeAnswers") && $answerStream->getAttribute("type") == "option" && empty($content)) {
		throw new Exception($text['AnswerCantBeChanged']);
	}

	$relatedAnswers = Streams_RelatedTo::select()->where(array(
		"toPublisherId" => $questionStream->publisherId,
		"toStreamName" => $questionStream->name,
		"type" => "Streams/answers",
	))->fetchDbRows();
	foreach ($relatedAnswers as $relatedAnswer) {
		$relatedAnswer = Streams::fetchOne(null, $relatedAnswer->fromPublisherId, $relatedAnswer->fromStreamName, true);
		$participated = Streams_Participant::select("count(*) as res")
			->where(array(
				"publisherId" => $relatedAnswer->publisherId,
				"streamName" => $relatedAnswer->name,
				"userId" => $user->id,
				"state" => "participating"
			))
			->ignoreCache()
			->execute()
			->fetchAll(PDO::FETCH_ASSOC)[0]["res"];
		if ($participated) {
			if ($questionStream->getAttribute("cantChangeAnswers") && $answerStream->getAttribute("type") != "option" && $relatedAnswer->getAttribute("type") != "option") {
				throw new Exception($text['AnswerCantBeChanged']);
			}

			if ($answerStream->getAttribute("type") == "option.exclusive" && $relatedAnswer->name != $answerStream->name) {
				$relatedAnswer->leave(array('userId' => $user->id));
			}
		}
	}

	$options = array(
		'userId' => $user->id,
		'extra' => array()
	);
	if (empty($content)) {
		$options["extra"] = array(
			"content" => ''
		);
		$answerStream->leave($options);
	} else {
		$options["extra"] = array(
			"content" => $content
		);
		$answerStream->join($options);
	}

	$answerStream->post($user->id, array(
		'type' => 'Streams/extra/changed',
		'content' => $content
	), true);

	Q_Response::setSlot("content", $content);
}