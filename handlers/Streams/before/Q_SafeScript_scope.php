<?php

// ═══════════════════════════════════════════════════════════════════
// Users plugin — identity, authentication, contacts
// File: plugins/Users/handlers/Q/SafeScript/scope.php
// ═══════════════════════════════════════════════════════════════════

function Users_before_Q_SafeScript_scope($params)
{
	$scope = &$params['scope'];

	// Current user
	$scope['Users_loggedInUserId'] = function () {
		return Users::loggedInUserId();
	};
	$scope['Users_loggedInUser'] = function ($throwIfNotLoggedIn = false) {
		$user = Users::loggedInUser($throwIfNotLoggedIn, false);
		if (!$user) return null;
		return array(
			'id' => $user->id,
			'username' => $user->username,
			'icon' => $user->icon,
			'displayName' => $user->displayName()
		);
	};

	// Fetch user info
	$scope['Users_fetch'] = function ($userId) {
		$user = Users::fetch($userId, false);
		if (!$user) return null;
		return array(
			'id' => $user->id,
			'username' => $user->username,
			'icon' => $user->icon,
			'displayName' => $user->displayName()
		);
	};

	// Roles
	$scope['Users_roles'] = function ($communityId = null, $userId = null) {
		return Users::roles($communityId, false, array(), $userId);
	};

	// Contacts
	$scope['Users_getContacts'] = function ($userId, $label, $options = array()) {
		$contacts = Users_Contact::select()
			->where(array(
				'userId' => $userId,
				'label' => $label
			))->fetchDbRows();
		$result = array();
		foreach ($contacts as $c) {
			$result[] = array(
				'userId' => $c->userId,
				'contactUserId' => $c->contactUserId,
				'label' => $c->label,
				'nickname' => $c->nickname
			);
		}
		return $result;
	};

	// Labels
	$scope['Users_getLabels'] = function ($userId = null) {
		if (!$userId) $userId = Users::loggedInUserId();
		if (!$userId) return array();
		$labels = Users_Label::fetch($userId, '', array('skipAccess' => true));
		$result = array();
		foreach ($labels as $l) {
			$result[] = array(
				'label' => $l->label,
				'title' => $l->title,
				'icon' => $l->icon
			);
		}
		return $result;
	};
}