import Platform from 'Platform';
import Config from 'Config';
import Server from './server';
import MemberProfileDialog from '../views/common/member-profile-dialog';
import Messager from '../components/messager';
import ContextMenu from '../components/context-menu';
import modal from '../components/modal';
import {isWebUrl, getSearchParam} from '../utils/html-helper';
import Lang from '../lang';
import Events from './events';
import profile from './profile';
import Notice from './notice';
import ImageViewer from '../components/image-viewer';
import Store from '../utils/store';
import {executeCommand, registerCommand} from './commander';

const EVENT = {
    app_link: 'app.link',
    net_online: 'app.net.online',
    net_offline: 'app.net.offline',
    ready: 'app.ready'
};

const createImageContextMenuItems = (url, dataType) => {
    const items = [{
        label: Lang.string('menu.image.view'),
        click: () => {
            ImageViewer.show(url);
        }
    }];
    if (Platform.clipboard && Platform.clipboard.writeImageFromUrl) {
        items.push({
            label: Lang.string('menu.image.copy'),
            click: () => {
                Platform.clipboard.writeImageFromUrl(url, dataType);
            }
        });
    }
    if (Platform.dialog && Platform.dialog.saveAsImageFromUrl) {
        items.push({
            label: Lang.string('menu.image.saveAs'),
            click: () => {
                if (url.startsWith('file://')) {
                    url = url.substr(7);
                }
                return Platform.dialog.saveAsImageFromUrl(url, dataType).then(filename => {
                    if (filename) {
                        Messager.show(Lang.format('file.fileSavedAt.format', filename), {
                            actions: Platform.ui.openFileItem ? [{
                                label: Lang.string('file.open'),
                                click: () => {
                                    Platform.ui.openFileItem(filename);
                                }
                            }, {
                                label: Lang.string('file.openFolder'),
                                click: () => {
                                    Platform.ui.showItemInFolder(filename);
                                }
                            }] : null
                        });
                    }
                });
            }
        });
    }
    if (Platform.ui.openFileItem && dataType !== 'base64') {
        items.push({
            label: Lang.string('menu.image.open'),
            click: () => {
                if (url.startsWith('file://')) {
                    url = url.substr(7);
                }
                Platform.ui.openFileItem(url);
            }
        });
    }

    return items;
};

const createLinkContextMenu = (link, text) => {
    const items = [{
        label: Lang.string('common.openLink'),
        click: () => {
            Platform.ui.openExternal(link);
        }
    }];
    if (Platform.clipboard && Platform.clipboard.writeText) {
        items.push({
            label: Lang.string('common.copyLink'),
            click: () => {
                Platform.clipboard.writeText(link);
            }
        });

        if (text && text !== link && `${text}/` !== link) {
            items.push({
                label: Lang.format('common.copyFormat', text.length > 25 ? `${text.substr(0, 25)}…` : text),
                click: () => {
                    Platform.clipboard.writeText(text);
                }
            });
        }
    }
    return items;
};

const onAppLinkClick = (type, listener) => {
    return Events.on(`${EVENT.app_link}.${type}`, listener);
};

const emitAppLinkClick = (element, type, target, ...params) => {
    return Events.emit(`${EVENT.app_link}.${type}`, target, element, ...params);
};

onAppLinkClick('Member', target => {
    MemberProfileDialog.show(target);
});

let clearCopyCodeTip = null;
if (Platform.clipboard && Platform.clipboard.writeText) {
    registerCommand('copyCode', context => {
        const element = context.targetElement;
        if (element) {
            if (clearCopyCodeTip) {
                clearTimeout(clearCopyCodeTip);
                clearCopyCodeTip = null;
            }
            const code = element.nextElementSibling.innerText;
            Platform.clipboard.writeText(code);
            element.setAttribute('data-hint', Lang.string('common.copied'));
            element.classList.add('hint--success');
            clearCopyCodeTip = setTimeout(() => {
                clearCopyCodeTip = null;
                element.setAttribute('data-hint', Lang.string('common.copyCode'));
                element.classList.remove('hint--success');
            }, 2000);
            return true;
        }
        return false;
    });
}

Server.onUserLogin((user, loginError) => {
    if (!loginError && user.isFirstSignedToday) {
        Messager.show(Lang.string('login.signed'), {
            type: 'success',
            icon: 'calendar-check',
            autoHide: true,
        });
    }
    if (typeof Pace !== 'undefined') {
        Pace.stop();
    }
});

Server.onUserLoginout((user, code, reason, unexpected) => {
    if (user) {
        let errorCode = null;
        if (reason === 'KICKOFF') {
            errorCode = 'KICKOFF';
        }
        if (errorCode) {
            Messager.show(Lang.error(errorCode), {
                type: 'danger',
                icon: 'alert',
                actions: [{
                    label: Lang.string('login.retry'),
                    click: () => {
                        Server.login(user);
                    }
                }]
            });
            if (Notice.requestAttention) {
                Notice.requestAttention();
            }
        }
    }
});

document.body.classList.add(`os-${Platform.env.os}`);

export const openUrl = (url, targetElement) => {
    if (isWebUrl(url)) {
        Platform.ui.openExternal(url);
        return true;
    } else if (url[0] === '@') {
        const params = url.substr(1).split('/');
        emitAppLinkClick(targetElement, ...params);
        return true;
    } else if (url[0] === '!') {
        executeCommand(url.substr(1), {targetElement});
        return true;
    }
};

document.addEventListener('click', e => {
    let target = e.target;
    while (target && !((target.classList && target.classList.contains('app-link')) || (target.tagName === 'A' && target.attributes.href))) {
        target = target.parentNode;
    }

    if (target && (target.tagName === 'A' || target.classList.contains('app-link')) && (target.attributes.href || target.attributes['data-url'])) {
        const link = (target.attributes['data-url'] || target.attributes.href).value;
        if (openUrl(link)) {
            e.preventDefault();
        }
    }
});

window.addEventListener('online', () => {
    // Events.emit(EVENT.net_online);
    if (profile.user) {
        if (!Server.socket.isLogging) {
            Server.login(profile.user);
        }
    }
});
window.addEventListener('offline', () => {
    // Events.emit(EVENT.net_offline);
    if (profile.isUserOnline) {
        profile.user.markDisconnect();
        Server.socket.close(null, 'net_offline');
    }
});


let dragLeaveTask;
const completeDragNDrop = () => {
    document.body.classList.remove('drag-n-drop-over-in');
    setTimeout(() => {
        document.body.classList.remove('drag-n-drop-over');
    }, 350);
};

window.ondragover = e => {
    clearTimeout(dragLeaveTask);
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        document.body.classList.add('drag-n-drop-over');
        setTimeout(() => {
            document.body.classList.add('drag-n-drop-over-in');
        }, 10);
    }
    e.preventDefault();
    return false;
};
window.ondragleave = e => {
    clearTimeout(dragLeaveTask);
    dragLeaveTask = setTimeout(completeDragNDrop, 300);
    e.preventDefault();
    return false;
};
window.ondrop = e => {
    clearTimeout(dragLeaveTask);
    completeDragNDrop();
    if (DEBUG) {
        console.collapse('DRAG FILE', 'redBg', (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length ? e.dataTransfer.files[0].path : ''), 'redPale');
        console.log(e);
        console.groupEnd();
    }
    e.preventDefault();
    return false;
};


if (Platform.ui.onRequestQuit) {
    Platform.ui.onRequestQuit(closeReason => {
        if (closeReason !== 'quit') {
            const user = profile.user;
            if (user && !user.isUnverified) {
                const appCloseOption = user.config.appCloseOption;
                if (appCloseOption === 'minimize' || !Platform.ui.showQuitConfirmDialog) {
                    Platform.ui.hideWindow();
                    return false;
                } else if (appCloseOption !== 'close' && Platform.ui.showQuitConfirmDialog) {
                    Platform.ui.showQuitConfirmDialog((result, checked) => {
                        if (checked && result) {
                            user.config.appCloseOption = result;
                        }
                        if (result === 'close') {
                            Server.logout();
                        }
                        return result;
                    });
                    return false;
                }
            }
        }
        Server.logout();
    });
}

let quit = null;
if (Platform.ui.quit) {
    quit = (delay = 1000, ignoreListener = true) => {
        if (ignoreListener) {
            Server.logout();
        }
        Platform.ui.quit(delay, ignoreListener);
    };
}

if (Platform.ui.onWindowMinimize) {
    Platform.ui.onWindowMinimize(() => {
        const userConfig = profile.userConfig;
        if (userConfig && userConfig.removeFromTaskbarOnHide) {
            Platform.ui.setShowInTaskbar(false);
        }
    });
}

if (Platform.ui.onWindowBlur && Platform.ui.hideWindow) {
    Platform.ui.onWindowBlur(() => {
        const userConfig = profile.userConfig;
        if (userConfig && userConfig.hideWindowOnBlur) {
            Platform.ui.hideWindow();
        }
    });
}

const reloadWindow = () => {
    return modal.confirm(Lang.string('dialog.reloadWindowConfirmTip'), {title: Lang.string('dialog.reloadWindowConfirm')}).then(confirmed => {
        if (confirmed) {
            Server.logout();
            setTimeout(() => {
                Store.set('autoLoginNextTime', true);
                if (Platform.ui.reloadWindow) {
                    Platform.ui.reloadWindow();
                } else {
                    window.location.reload();
                }
            }, 1000);
        }
        return Promise.resolve(confirm);
    });
};

export const isAutoLoginNextTime = () => {
    const autoLoginNextTime = Store.get('autoLoginNextTime');
    if (autoLoginNextTime) {
        Store.remove('autoLoginNextTime');
    }
    return autoLoginNextTime;
};

// Decode url params
const entryParams = getSearchParam();

export const triggerReady = () => {
    Events.emit(EVENT.ready);
};

export const onReady = listener => {
    return Events.on(EVENT.ready, listener);
};

const setTitle = title => {
    document.title = title;
};

setTitle(Config.pkg.productName);

export const getUrlMeta = (url) => {
    if (Platform.ui.getUrlMeta) {
        return Platform.ui.getUrlMeta(url).then(meta => {
            
            const favicons = meta.favicons;
            return Promise.resolve({
                url,
                title: meta.title,
                subtitle: url,
                image: meta.image,
                desc: meta.description.length > 200 ? `${meta.description.substring(0, 200)}...` : meta.description,
                icon: favicons && favicons.length ? favicons[0].href : null
            });
        });
    }
    return Promise.resolve({url, title: url});
};

export default {
    entryParams,
    get canQuit() {
        return !!Platform.ui.quit;
    },
    onAppLinkClick,
    emitAppLinkClick,
    quit,
    showMessger: Messager.show,
    showContextMenu: ContextMenu.show,
    modal,
    createImageContextMenuItems,
    createLinkContextMenu,
    reloadWindow,
    triggerReady,
    onReady,
    isAutoLoginNextTime,
    openUrl,
    getUrlMeta
};
