<?php

function Users_after_Q_image_save($params, &$authorized)
{
    extract($params);
    /**
     * @var string $path
     * @var string $subpath
     * @var Users_User $user
     */
    $user = Q::ifset(Users::$cache, 'user', Users::loggedInUser(false, false));
    if (!$user) {
        return;
    }

    $fullpath = $path.($subpath ? DS.$subpath : '');
    Q_Utils::normalizePath($fullpath);

    $splitId = Q_Utils::splitId($user->id);
    $prefix = "Q/uploads/Users/$splitId";
    Q_Utils::normalizePath($prefix);

    if (Q::startsWith($fullpath, $prefix)) {
        $iconPrefix = "Q/uploads/Users/$splitId/icon";
        $invitePrefix = "Q/uploads/Users/$splitId/invited";
        Q_Utils::normalizePath($iconPrefix);
        Q_Utils::normalizePath($invitePrefix);
        if (Q::startsWith($fullpath,$iconPrefix)) {
            // modification of logged user icon
            if ($user->icon != $subpath) {
                $user->icon = Q_Html::themedUrl("$path/$subpath", array(
                    'baseUrlPlaceholder' => true
                ));
                $user->save(); // triggers any registered hooks
                Users::$cache['iconUrlWasChanged'] = true;
            } else {
                Users::$cache['iconUrlWasChanged'] = false;
            }
        } else if (Q::startsWith($fullpath, $invitePrefix)) {
            $token = preg_replace('/.*\/invited\//', '', $subpath);
            $invites = Streams_Invite::select()->where(
                array('token' => $token, 'state' => 'accepted'
                ))->fetchDbRows();
            if (!empty($invites)) {
                $user = Users::fetch($invites[0]->userId);
                if ($user and $user->icon != $subpath
                and !Users::isCustomIcon($user->icon, true)) {
                    $user->icon = Q_Html::themedUrl("$path/$subpath", array(
						'baseUrlPlaceholder' => true
					));
                    $user->save();
                }
            }
        }
    } else if (Q::startsWith($fullpath, implode(DS, array('Q', 'uploads', 'Users')))
    and preg_match('/(\/[a-zA-Z]{2,3}){2,3}\/icon\//', $fullpath)) {
        // modification of another user
        // trying to fetch userId from subpath
        $anotherUserId = preg_replace('/\/icon.*/', '', $subpath);
        $anotherUserId = preg_replace('/\//', '', $anotherUserId);

        $anotherUser = Users_User::fetch($anotherUserId, false);

        if (!$anotherUser) {
            return;
        }

        // label can manage icons of other users
        $labelsCanManage = Q_Config::get("Users", "icon", "canManage", array());

        // whether logged user assigned as one of $labelsCanManage to $anotherUser
		$authorized = (bool)Users::roles($anotherUserId, $labelsCanManage, array(), $user->id);
		if (!$authorized and !empty($_REQUEST['inviteToken'])) {
            if ($seconds = Q_Config::get('Streams', 'invites', 'canSetIcon', 'within', 30000)) {
                $invites = Streams_Invite::select()->where(array(
                    'token' => $_REQUEST['inviteToken'],
                    'state' => 'accepted',
                    'insertedTime >=' => new Db_Expression("CURRENT_TIMESTAMP - INTERVAL $seconds SECOND")
                ))->fetchDbRows();
                if (!empty($invites)) {
                    $authorized = true;
                }
            }
        }

        if (!$authorized) {
			throw new Users_Exception_NotAuthorized();
		}
        if ($anotherUser->icon != $subpath) {
            $anotherUser->icon = Q_Html::themedUrl("$path/$subpath", array(
				'baseUrlPlaceholder' => true
			));
            $anotherUser->save(); // triggers any registered hooks
            Users::$cache['iconUrlWasChanged'] = true;
        } else {
            Users::$cache['iconUrlWasChanged'] = false;
        }
    }
}