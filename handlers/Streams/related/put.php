<?php

/**
 * @module Streams
 */

/**
 * Used to update or retype a relation between streams.
 * Pass 'weight' to update the weight of an existing relation.
 * You can also pass 'changeType' to atomically change the type of an existing relation,
 * preserving its weight and extra fields. This is preferred over separate
 * DELETE and POST requests because it executes within a single request,
 * allowing hooks to inspect Streams::$relationTransitions and distinguish
 * a type transition from an unrelated removal or a fresh relation.
 * Both 'changeType' and 'weight' can be passed together.
 * @class HTTP Streams related
 * @method put
 * @param {array} [$_REQUEST] Parameters that can come from the request
 *   @param {string} $_REQUEST.toPublisherId The publisher of the 'to' stream
 *   @param {string} $_REQUEST.toStreamName The name of the 'to' stream
 *   @param {string} $_REQUEST.type The current type of the relation
 *   @param {string} $_REQUEST.fromPublisherId The publisher of the 'from' stream
 *   @param {string} $_REQUEST.fromStreamName The name of the 'from' stream
 *   @param {string} [$_REQUEST.changeType] Pass this to change the relation type
 *     within a single request. Hooks will see the old type in removedTypes and
 *     the new type in addedTypes via Streams::$relationTransitions, allowing them
 *     to correctly identify this as a type transition rather than a removal
 *     followed by a fresh relation.
 *   @param {double} [$_REQUEST.weight] Pass this to update the weight of the relation
 * @return {void}
 */
function Streams_related_put($params) {
    $user            = Users::loggedInUser(true);
    $userId          = $user->id;
    $toPublisherId   = $_REQUEST['toPublisherId'];
    $toStreamName    = $_REQUEST['toStreamName'];
    $type            = $_REQUEST['type'];
    $fromPublisherId = $_REQUEST['fromPublisherId'];
    $fromStreamName  = $_REQUEST['fromStreamName'];

    if (isset($_REQUEST['changeType'])) {
        // Fetch existing relation to preserve weight and extra
        $rt = new Streams_RelatedTo();
        $rt->toPublisherId   = $toPublisherId;
        $rt->toStreamName    = $toStreamName;
        $rt->type            = $type;
        $rt->fromPublisherId = $fromPublisherId;
        $rt->fromStreamName  = $fromStreamName;
        if (!$rt->retrieve()) {
            throw new Q_Exception_MissingRow(array(
                'table'    => 'Streams_RelatedTo',
                'criteria' => 'those fields'
            ));
        }
        // Use new weight if provided, otherwise preserve existing
        $weight = isset($_REQUEST['weight']) ? $_REQUEST['weight'] : $rt->weight;
        $extra  = $rt->extra;

        $opts = array('weight' => $weight);
        if ($extra) {
            $opts['extra'] = array($fromStreamName => $extra);
        }

        Streams_RelatedTo::begin()->execute();
        try {
            Streams::unrelate(
                $userId,
                $toPublisherId, $toStreamName,
                $type,
                $fromPublisherId, $fromStreamName,
                $opts
            );
            Streams::relate(
                $userId,
                $toPublisherId, $toStreamName,
                $_REQUEST['changeType'],
                $fromPublisherId, $fromStreamName,
                $opts
            );
            Streams_RelatedTo::commit()->execute();
        } catch (Exception $e) {
            Streams_RelatedTo::rollback()->execute();
            throw $e;
        }

        Q_Response::setSlot('result', true);

    } else if (isset($_REQUEST['weight'])) {
        $result = Streams::updateRelation(
            $userId,
            $toPublisherId, $toStreamName,
            $type,
            $fromPublisherId, $fromStreamName,
            $_REQUEST['weight'],
            1
        );
        Q_Response::setSlot('result', $result);
    }
}