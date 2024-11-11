<?php
/**
 * @module Streams
 */
/**
 * Class for making internal, privileged calls to modify the Streams database
 * @class Streams_Internal
 */
class Streams_Internal
{
    /**
     * Post one or more fields here to change the corresponding basic streams for the logged-in user
     * @method updateBasicStreams
     * @param {string} $userId
     * @param {array}  $params Can include the following
     * @param {string} $params.firstName specify the first name directly
     * @param {string} $params.lastName specify the last name directly
     * @param {string} $params.fullName the user's full name, which if provided will be split into first and last name and override them
     * @param {string} $params.gender the user's gender
     * @param {string} $params.birthday_year the year the user was born
     * @param {string} $params.birthday_month the month the user was born
     * @param {string} $params.birthday_day the day the user was born
     * @param {boolean} [$override = false] set to true to override content of streams even if they're not empty
     */
    static function updateBasicStreams($userId, $params, $override = false)
    {
        $user = $userId ? Users::fetch($userId) : Users::loggedInUser(true);
        $fields = array();
        if (!empty($params['birthday_year'])
        && !empty($params['birthday_month'])
        && !empty($params['birthday_day'])) {
            $params['birthday'] = sprintf("%04d-%02d-%02d",
                $_REQUEST['birthday_year'],
                $_REQUEST['birthday_month'],
                $_REQUEST['birthday_day']
            );
        }
        //	$params['icon'] = $user->icon;
        if (isset($params['fullName'])) {
            $name = Streams::splitFullName($params['fullName']);
            $params['firstName'] = $name['first'];
            $params['lastName'] = $name['last'];
        }
        foreach (array('firstName', 'lastName', 'birthday', 'gender') as $field) {
            if (isset($params[$field])) {
                $fields[] = $field;
            }
        }
        $p = Streams::userStreamsTree();
        $names = array();
        foreach ($fields as $field) {
            $names[] = "Streams/user/$field";
        }
        $streams = Streams::fetch($user, $user->id, $names);
        foreach ($fields as $field) {
            $name = "Streams/user/$field";
            $type = $p->get($name, "type", null);
            if (!$type) {
                throw new Q_Exception("Missing $name type", $field);
            }
            $title = $p->get($name, "title", null);
            if (!$title) {
                throw new Q_Exception("Missing $name title", $field);
            }
            $stream = $streams[$name];
            if (isset($stream)) {
                if ($stream->content === (string)$params[$field]
                or ($stream->content and !$override)) {
                    continue;
                }
            }
            if (!isset($stream)) {
                $stream = Streams::create($user->id, $user->id, $type, array(
                    'name' => $name
                ));
            }
            $messageType = $stream->wasRetrieved() ? 'Streams/changed' : 'Streams/created';
            $stream->content = (string)$params[$field];
            $stream->type = $type;
            $stream->title = $title;
            $stream->changed($user->id, false, $messageType);
        }
    }
}