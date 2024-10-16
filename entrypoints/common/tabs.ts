import { Tabs } from 'wxt/browser';
import { settingsUtils, tabListUtils } from './storage';
import type { SettingsProps } from '~/entrypoints/types';
import { ENUM_SETTINGS_PROPS, IS_GROUP_SUPPORT } from '~/entrypoints/common/constants';
import { objectToUrlParams, getRandomId } from '~/entrypoints/common/utils';

const {
  OPEN_ADMIN_TAB_AFTER_SEND_TABS,
  CLOSE_TABS_AFTER_SEND_TABS,
  AUTO_PIN_ADMIN_TAB,
  ALLOW_SEND_PINNED_TABS,
} = ENUM_SETTINGS_PROPS;

// const matchUrls: string[] = ['https://*/*', 'http://*/*', 'chrome://*/*', 'file://*/*'];

export async function getAdminTabInfo() {
  const adminTabUrl = browser.runtime.getURL('/options.html');
  const [tab] = await browser.tabs.query({ url: `${adminTabUrl}*`, currentWindow: true });

  return { tab, adminTabUrl };
}
// 打开管理后台
export async function openAdminRoutePage(
  route: { path: string; query?: Record<string, string> },
  needOpen = true
) {
  const paramsStr = objectToUrlParams(
    Object.assign(route?.query || {}, { randomId: getRandomId(6) })
  );
  const settings = await settingsUtils.getSettings();
  const { tab, adminTabUrl } = await getAdminTabInfo();
  const urlWithParams = `${adminTabUrl}#${route.path || '/home'}${
    paramsStr ? `?${paramsStr}` : ''
  }`;

  // 如果发送标签页后不需要打开管理后台页面，则刷新管理后台页
  if (!needOpen && tab?.id) {
    browser.tabs.update(tab.id, { url: urlWithParams });
    return;
  }

  if (tab?.id) {
    await browser.tabs.move(tab.id, { index: 0 });
    await browser.tabs.update(tab.id, {
      highlighted: true,
      pinned: !!settings[AUTO_PIN_ADMIN_TAB],
      url: urlWithParams,
    });
    // browser.tabs.reload(tab.id); // 这个方法会清空路由参数，切记
  } else {
    await browser.tabs.create({
      index: 0,
      url: urlWithParams,
      pinned: !!settings[AUTO_PIN_ADMIN_TAB],
    });
  }
}
// 打开管理后台
export async function openAdminTab(
  settingsData?: SettingsProps,
  params?: { tagId: string; groupId: string }
) {
  const settings = settingsData || (await settingsUtils.getSettings());
  const openAdminTabAfterSendTabs = settings[OPEN_ADMIN_TAB_AFTER_SEND_TABS];
  await openAdminRoutePage({ path: '/home', query: params }, openAdminTabAfterSendTabs);

  if (!openAdminTabAfterSendTabs) {
    // 如果设置了 发送标签页后不打开管理后台，则可以发送通知提醒
    // browser.notifications.create(undefined, {
    //   type: 'basic',
    //   title: '标签页发送成功',
    //   message: '标签页已发送到管理后台，可在管理后台查看',
    //   iconUrl: browser.runtime.getURL('/icon/logo.png'),
    // });
  }
}
// 获取过滤后的标签页
async function getFilteredTabs(
  tabs: Tabs.Tab[],
  settings: SettingsProps,
  validator?: (tab: Tabs.Tab) => boolean
) {
  const { tab: adminTab } = await getAdminTabInfo();
  return tabs.filter((tab) => {
    if (!tab?.id) return false;
    if (adminTab && adminTab.id === tab.id) return false;
    // 如果设置不允许发送固定标签页，则过滤掉固定标签页
    if (tab.pinned && !settings[ALLOW_SEND_PINNED_TABS]) {
      return false;
    }
    if (validator) {
      return validator(tab);
    }
    return true;
  });
}
// 取消标签页高亮
async function cancelHighlightTabs(tabs?: Tabs.Tab[]) {
  await new Promise((res) => setTimeout(res, 50));
  if (tabs) {
    tabs.forEach((tab) => {
      tab?.highlighted &&
        browser.tabs.update(tab.id, { highlighted: false, active: false });
    });
  } else {
    const highlightedTabs = await browser.tabs.query({
      highlighted: true,
      currentWindow: true,
    });
    const { tab: adminTab } = await getAdminTabInfo();
    highlightedTabs.forEach((tab) => {
      if (adminTab && adminTab.id !== tab.id) {
        browser.tabs.update(tab.id, { highlighted: false, active: false });
      }
    });
  }
}
// 获取全部标签页
export async function getAllTabs() {
  return await browser.tabs.query({ currentWindow: true });
}
// 发送标签页逻辑
async function sendAllTabs() {
  const tabs = await browser.tabs.query({
    // url: matchUrls,
    currentWindow: true,
  });

  // 获取插件设置
  const settings = await settingsUtils.getSettings();
  const filteredTabs = await getFilteredTabs(tabs, settings);
  const { tagId, groupId } = await tabListUtils.createTabs(filteredTabs);
  await openAdminTab(settings, { tagId, groupId });
  if (settings[CLOSE_TABS_AFTER_SEND_TABS]) {
    setTimeout(() => {
      browser.tabs.remove(filteredTabs.map((t) => t.id as number).filter(Boolean));
    }, 30);
  } else {
    // 如果发送标签页后打开管理后台，则跳转之后将之前高亮的标签页取消高亮
    cancelHighlightTabs(filteredTabs);
  }
}
// 发送当前选中的标签页（支持多选）
async function sendCurrentTab() {
  const tabs = await browser.tabs.query({
    // url: matchUrls,
    highlighted: true,
    currentWindow: true,
  });

  const settings = await settingsUtils.getSettings();
  let filteredTabs = await getFilteredTabs(tabs, settings);
  // 发送当前选中的标签页时，选中的标签页成组，不考虑原生标签组（即多选时，选中的非标签组的标签页和标签组中的标签页合并到一个组）
  filteredTabs = filteredTabs.map((tab) => ({ ...tab, groupId: -1 }));
  const { tagId, groupId } = await tabListUtils.createTabs(filteredTabs);
  openAdminTab(settings, { tagId, groupId });
  if (settings[CLOSE_TABS_AFTER_SEND_TABS]) {
    browser.tabs.remove(filteredTabs.map((t) => t.id as number).filter(Boolean));
  } else {
    // 如果发送标签页后打开管理后台，则跳转之后将之前高亮的标签页取消高亮
    cancelHighlightTabs(filteredTabs);
  }
}
async function sendOtherTabs() {
  const tabs = await browser.tabs.query({
    // url: matchUrls,
    highlighted: false,
    currentWindow: true,
  });
  const settings = await settingsUtils.getSettings();
  const filteredTabs = await getFilteredTabs(tabs, settings);
  const { tagId, groupId } = await tabListUtils.createTabs(filteredTabs);
  openAdminTab(settings, { tagId, groupId });
  if (settings[CLOSE_TABS_AFTER_SEND_TABS]) {
    browser.tabs.remove(filteredTabs.map((t) => t.id as number).filter(Boolean));
  }
  // 如果发送标签页后打开管理后台，则跳转之后将之前高亮的标签页取消高亮
  cancelHighlightTabs();
}
async function sendLeftTabs(currTab?: Tabs.Tab) {
  const tabs = await browser.tabs.query({
    // url: matchUrls,
    currentWindow: true,
  });
  let leftTabs = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    if (tab.id === currTab?.id) break;
    leftTabs.push(tab);
  }

  const settings = await settingsUtils.getSettings();
  const filteredTabs = await getFilteredTabs(leftTabs, settings);
  const { tagId, groupId } = await tabListUtils.createTabs(filteredTabs);
  openAdminTab(settings, { tagId, groupId });

  if (settings[CLOSE_TABS_AFTER_SEND_TABS]) {
    browser.tabs.remove(filteredTabs.map((t) => t.id as number).filter(Boolean));
  }
  // 如果发送标签页后打开管理后台，则跳转之后将之前高亮的标签页取消高亮
  cancelHighlightTabs();
}
async function sendRightTabs(currTab?: Tabs.Tab) {
  const tabs = await browser.tabs.query({
    // url: matchUrls,
    currentWindow: true,
  });
  let rightTabs = [];
  for (let i = tabs.length - 1; i >= 0; i--) {
    const tab = tabs[i];
    if (tab.id === currTab?.id) break;
    rightTabs.unshift(tab);
  }

  const settings = await settingsUtils.getSettings();
  const filteredTabs = await getFilteredTabs(rightTabs, settings);
  const { tagId, groupId } = await tabListUtils.createTabs(filteredTabs);
  openAdminTab(settings, { tagId, groupId });

  if (settings[CLOSE_TABS_AFTER_SEND_TABS]) {
    browser.tabs.remove(filteredTabs.map((t) => t.id as number).filter(Boolean));
  }
  // 如果发送标签页后打开管理后台，则跳转之后将之前高亮的标签页取消高亮
  cancelHighlightTabs();
}

/*
打开新标签页
active：打开标签页是否激活
openToNext：是否紧随管理后台页之后打开
*/
export async function openNewTab(
  url?: string,
  { active = false, openToNext = false }: { active?: boolean; openToNext?: boolean } = {}
) {
  if (!openToNext) {
    url && browser.tabs.create({ url, active });
    return;
  }

  const { tab } = await getAdminTabInfo();
  const newTabIndex = (tab?.index || 0) + 1;
  // 注意：如果打开标签页不想 active, 则 active 必须设置默认值为 false，
  // create 方法 active参数传 undefined 也会激活 active
  url && browser.tabs.create({ url, active, index: newTabIndex });
}

// 打开标签组
export async function openNewGroup(groupName: string, urls: Array<string | undefined>) {
  if (!IS_GROUP_SUPPORT) {
    for (let url of urls) {
      openNewTab(url);
    }
    return;
  }

  Promise.all(
    urls.map((url) => {
      return browser.tabs.create({ url, active: false });
    })
  ).then(async (tabs) => {
    const filteredTabs = tabs.filter((tab) => !!tab.id);
    const bsGroupId = await browser.tabs.group({
      tabIds: filteredTabs.map((tab) => tab.id!),
    });
    browser.tabGroups?.update(bsGroupId, { title: groupName });
  });
}

export default {
  getAdminTabInfo,
  openAdminRoutePage,
  openAdminTab,
  getFilteredTabs,
  getAllTabs,
  sendAllTabs,
  sendCurrentTab,
  sendOtherTabs,
  sendLeftTabs,
  sendRightTabs,
  openNewTab,
};
