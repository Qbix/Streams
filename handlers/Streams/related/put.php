<?php

/**
 * @module Streams
 */

/**
 * Used to update or retype a relation between streams.
 * Pass 'changeType' to atomically unrelate and re-relate with a new type,
 * preserving its weight and extra fields.
 * Otherwise pass 'weight' to update the weight of an existing relation.
 * @class HTTP Streams related
 * @method put
 * @param {array} [$_REQUEST] Parameters that can come from the request
 *   @param {string} $_REQUEST.toPublisherId The publisher of the 'to' stream
 *   @param {string} $_REQUEST.toStreamName The name of the 'to' stream
 *   @param {string} $_REQUEST.type The current type of the relation
 *   @param {string} $_REQUEST.fromPublisherId The publisher of the 'from' stream
 *   @param {string} $_REQUEST.fromStreamName The name of the 'from' stream
 *   @param {string} [$_REQUEST.changeType] Pass this to unrelate and relate with new type atomically
 *   @param {double} [$_REQUEST.weight] Pass this to update the weight of the relation
 * @return {void}
 */
function Streams_related_put($params) {
    $user = Users::loggedInUser(true);
    $userId = $user->id;
    $toPublisherId   = $_REQUEST['toPublisherId'];
    $toStreamName    = $_REQUEST['toStreamName'];
    $type            = $_REQUEST['type'];
    $fromPublisherId = $_REQUEST['fromPublisherId'];
    $fromStreamName  = $_REQUEST['fromStreamName'];

    if (isset($_REQUEST['changeType'])) {
        // Change relation type atomically, preserving weight and extra
        // Fetch existing relation to preserve weight and extra
        $rt = new Streams_RelatedTo();
        $rt->toPublisherId   = $toPublisherId;
        $rt->toStreamName    = $toStreamName;
        $rt->type            = $type;
        $rt->fromPublisherId = $fromPublisherId;
        $rt->fromStreamName  = $fromStreamName;
        if (!$rt->retrieve()) {
            throw new Q_Exception_MissingRow(array(
                'table' => 'Streams_RelatedTo',
                'criteria' => 'those fields'
            ));
        }
        $weight = $rt->weight;
        $extra  = $rt->extra;

        $opts = array(
            'skipMessageTo'   => true,  // suppress unrelated/related messages
            'skipMessageFrom' => true,
            'weight'          => $weight
        );
        if ($extra) {
            $opts['extra'] = array($fromStreamName => $extra);
        }

        // Wrap in transaction — counter-based nesting means this is
        // the real BEGIN/COMMIT pair since we're at the top level here
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

    } else {
        $weight = $_REQUEST['weight'];
        $result = Streams::updateRelation(
            $userId,
            $toPublisherId, $toStreamName,
            $type,
            $fromPublisherId, $fromStreamName,
            $weight,
            1
        );
        Q_Response::setSlot('result', $result);
    }
}