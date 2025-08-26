const logger = require('./logger');
const { getAdminHelpMessage, getTechnicianHelpMessage, getCustomerHelpMessage, getGeneralHelpMessage, getVersionMessage, getSystemInfoMessage } = require('./help-messages');
const WhatsAppTroubleCommands = require('./whatsapp-trouble-commands');
const WhatsAppPPPoECommands = require('./whatsapp-pppoe-commands');

class WhatsAppMessageHandlers {
    constructor(whatsappCore, whatsappCommands) {
        this.core = whatsappCore;
        this.commands = whatsappCommands;
        this.troubleCommands = new WhatsAppTroubleCommands(whatsappCore);
        this.pppoeCommands = new WhatsAppPPPoECommands(whatsappCore);
    }

    // Main message handler
    async handleIncomingMessage(sock, message) {
        try {
            // Validasi input
            if (!message || !message.key) {
                logger.warn('Invalid message received', { message: typeof message });
                return;
            }
            
            // Ekstrak informasi pesan
            const remoteJid = message.key.remoteJid;
            if (!remoteJid) {
                logger.warn('Message without remoteJid received', { messageKey: message.key });
                return;
            }
            
            // Skip jika pesan dari grup dan bukan dari admin
            if (remoteJid.includes('@g.us')) {
                logger.debug('Message from group received', { groupJid: remoteJid });
                const participant = message.key.participant;
                if (!participant || !this.core.isAdminNumber(participant.split('@')[0])) {
                    logger.debug('Group message not from admin, ignoring', { participant });
                    return;
                }
                logger.info('Group message from admin, processing', { participant });
            }
            
            // Cek tipe pesan dan ekstrak teks
            let messageText = '';
            if (!message.message) {
                logger.debug('Message without content received', { messageType: 'unknown' });
                return;
            }
            
            if (message.message.conversation) {
                messageText = message.message.conversation;
                logger.debug('Conversation message received');
            } else if (message.message.extendedTextMessage) {
                messageText = message.message.extendedTextMessage.text;
                logger.debug('Extended text message received');
            } else {
                logger.debug('Unsupported message type received', { 
                    messageTypes: Object.keys(message.message) 
                });
                return;
            }
            
            // Ekstrak nomor pengirim
            let senderNumber;
            try {
                senderNumber = remoteJid.split('@')[0];
            } catch (error) {
                logger.error('Error extracting sender number', { remoteJid, error: error.message });
                return;
            }
            
            logger.info(`Message received`, { sender: senderNumber, messageLength: messageText.length });
            logger.debug(`Message content`, { sender: senderNumber, message: messageText });
            
            // Cek apakah pengirim adalah admin
            const isAdmin = this.core.isAdminNumber(senderNumber);
            logger.debug(`Sender admin status`, { sender: senderNumber, isAdmin });
            
            // Jika pesan kosong, abaikan
            if (!messageText.trim()) {
                logger.debug('Empty message, ignoring');
                return;
            }
            
            // Proses pesan
            await this.processMessage(remoteJid, senderNumber, messageText, isAdmin);
            
        } catch (error) {
            logger.error('Error in handleIncomingMessage', { error: error.message, stack: error.stack });
        }
    }

    // Process message and route to appropriate handler
    async processMessage(remoteJid, senderNumber, messageText, isAdmin) {
        const command = messageText.trim().toLowerCase();
        
        try {
            // Cek apakah pengirim bisa akses fitur teknisi
            const canAccessTechnician = this.core.canAccessTechnicianFeatures(senderNumber);
            
            // Admin commands (termasuk command teknisi)
            if (isAdmin) {
                await this.handleAdminCommands(remoteJid, senderNumber, command, messageText);
                return;
            }
            
            // Technician commands (untuk teknisi yang bukan admin)
            if (canAccessTechnician && !isAdmin) {
                await this.handleTechnicianCommands(remoteJid, senderNumber, command, messageText);
                return;
            }
            
            // Customer commands
            await this.handleCustomerCommands(remoteJid, senderNumber, command, messageText);
            
        } catch (error) {
            logger.error('Error processing message', { 
                command, 
                sender: senderNumber, 
                error: error.message 
            });
            
            // Send error message to user
            await this.commands.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nTerjadi kesalahan saat memproses perintah:\n${error.message}`
            );
        }
    }

    // Handle technician commands (untuk teknisi yang bukan admin)
    async handleTechnicianCommands(remoteJid, senderNumber, command, messageText) {
        // Command yang bisa diakses teknisi (tidak bisa akses semua fitur admin)
        
        // Help Commands
        if (command === 'teknisi') {
            await this.sendTechnicianHelp(remoteJid);
            return;
        }
        
        if (command === 'help') {
            await this.sendTechnicianHelp(remoteJid);
            return;
        }
        
        // Trouble Report Commands (PRIORITAS TINGGI)
        if (command === 'trouble') {
            await this.troubleCommands.handleListTroubleReports(remoteJid);
            return;
        }
        
        if (command.startsWith('status ')) {
            const reportId = messageText.split(' ')[1];
            await this.troubleCommands.handleTroubleReportStatus(remoteJid, reportId);
            return;
        }
        
        if (command.startsWith('update ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const newStatus = params[1];
                const notes = params.slice(2).join(' ');
                await this.troubleCommands.handleUpdateTroubleReport(remoteJid, reportId, newStatus, notes);
            }
            return;
        }
        
        if (command.startsWith('selesai ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 1) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleResolveTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }
        
        if (command.startsWith('catatan ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleAddNoteToTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }
        
        if (command === 'help trouble') {
            await this.troubleCommands.handleTroubleReportHelp(remoteJid);
            return;
        }
        
        // PPPoE Commands (PEMASANGAN BARU)
        if (command.startsWith('addpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const password = params[1];
                const profile = params[2];
                const ipAddress = params[3] || null;
                const customerInfo = params.slice(4).join(' ') || null;
                await this.pppoeCommands.handleAddPPPoE(remoteJid, username, password, profile, ipAddress, customerInfo);
            }
            return;
        }
        
        if (command.startsWith('editpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const field = params[1];
                const newValue = params.slice(2).join(' ');
                await this.pppoeCommands.handleEditPPPoE(remoteJid, username, field, newValue);
            }
            return;
        }
        
        if (command.startsWith('checkpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleCheckPPPoEStatus(remoteJid, username);
            return;
        }
        
        if (command.startsWith('restartpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleRestartPPPoE(remoteJid, username);
            return;
        }
        
        if (command === 'help pppoe') {
            await this.pppoeCommands.handlePPPoEHelp(remoteJid);
            return;
        }
        
        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }
        
        if (command === 'info') {
            const systemInfoMessage = getSystemInfoMessage();
            await this.commands.sendMessage(remoteJid, systemInfoMessage);
            return;
        }
        
        // Basic device commands (terbatas)
        if (command.startsWith('cek ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }
        
        if (command.startsWith('cekstatus ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }
        
        // Unknown command for technician
        await this.commands.sendMessage(remoteJid, 
            `❓ *PERINTAH TIDAK DIKENAL*\n\nPerintah "${command}" tidak dikenali.\n\nKetik *teknisi* untuk melihat menu teknisi.`
        );
    }

    // Handle admin commands
    async handleAdminCommands(remoteJid, senderNumber, command, messageText) {
        // GenieACS Commands
        if (command.startsWith('cek ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }
        
        if (command.startsWith('cekstatus ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleCekStatus(remoteJid, customerNumber);
            return;
        }
        
        if (command === 'cekall') {
            await this.commands.handleCekAll(remoteJid);
            return;
        }
        
        if (command.startsWith('refresh ')) {
            const deviceId = messageText.split(' ')[1];
            await this.commands.handleRefresh(remoteJid, deviceId);
            return;
        }
        
        if (command.startsWith('gantissid ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const customerNumber = params[0];
                const newSSID = params.slice(1).join(' ');
                await this.commands.handleGantiSSID(remoteJid, customerNumber, newSSID);
            }
            return;
        }
        
        if (command.startsWith('gantipass ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const customerNumber = params[0];
                const newPassword = params.slice(1).join(' ');
                await this.commands.handleGantiPassword(remoteJid, customerNumber, newPassword);
            }
            return;
        }
        
        if (command.startsWith('reboot ')) {
            const customerNumber = messageText.split(' ')[1];
            await this.commands.handleReboot(remoteJid, customerNumber);
            return;
        }
        
        if (command.startsWith('tag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const tag = params.slice(1).join(' ');
                await this.commands.handleAddTag(remoteJid, deviceId, tag);
            }
            return;
        }
        
        if (command.startsWith('untag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const tag = params.slice(1).join(' ');
                await this.commands.handleRemoveTag(remoteJid, deviceId, tag);
            }
            return;
        }
        
        if (command.startsWith('tags ')) {
            const deviceId = messageText.split(' ')[1];
            await this.commands.handleListTags(remoteJid, deviceId);
            return;
        }
        
        if (command.startsWith('addtag ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const deviceId = params[0];
                const customerNumber = params[1];
                await this.commands.handleAddTag(remoteJid, deviceId, customerNumber);
            }
            return;
        }
        
        // System Commands
        if (command === 'status') {
            await this.commands.handleStatus(remoteJid);
            return;
        }
        
        if (command === 'restart') {
            await this.commands.handleRestart(remoteJid);
            return;
        }
        
        if (command === 'ya' || command === 'iya' || command === 'yes') {
            await this.commands.handleConfirmRestart(remoteJid);
            return;
        }
        
        if (command === 'tidak' || command === 'no' || command === 'batal') {
            if (global.pendingRestart && global.restartRequestedBy === remoteJid) {
                global.pendingRestart = false;
                global.restartRequestedBy = null;
                await this.commands.sendMessage(remoteJid, 
                    `✅ *RESTART DIBATALKAN*\n\nRestart aplikasi telah dibatalkan.`
                );
            }
            return;
        }
        
        if (command === 'debug resource') {
            await this.commands.handleDebugResource(remoteJid);
            return;
        }
        
        if (command === 'checkgroup') {
            await this.commands.handleCheckGroup(remoteJid);
            return;
        }
        
        if (command.startsWith('setheader ')) {
            const newHeader = messageText.split(' ').slice(1).join(' ');
            await this.commands.handleSetHeader(remoteJid, newHeader);
            return;
        }
        
        // Trouble Report Commands
        if (command === 'trouble') {
            await this.troubleCommands.handleListTroubleReports(remoteJid);
            return;
        }
        
        if (command.startsWith('status ')) {
            const reportId = messageText.split(' ')[1];
            await this.troubleCommands.handleTroubleReportStatus(remoteJid, reportId);
            return;
        }
        
        if (command.startsWith('update ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const newStatus = params[1];
                const notes = params.slice(2).join(' ');
                await this.troubleCommands.handleUpdateTroubleReport(remoteJid, reportId, newStatus, notes);
            }
            return;
        }
        
        if (command.startsWith('selesai ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleResolveTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }
        
        if (command.startsWith('catatan ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 2) {
                const reportId = params[0];
                const notes = params.slice(1).join(' ');
                await this.troubleCommands.handleAddNoteToTroubleReport(remoteJid, reportId, notes);
            }
            return;
        }
        
        if (command === 'help trouble') {
            await this.troubleCommands.handleTroubleReportHelp(remoteJid);
            return;
        }
        
        // PPPoE Commands
        if (command.startsWith('addpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const password = params[1];
                const profile = params[2];
                const ipAddress = params[3] || null;
                const customerInfo = params.slice(4).join(' ') || null;
                await this.pppoeCommands.handleAddPPPoE(remoteJid, username, password, profile, ipAddress, customerInfo);
            }
            return;
        }
        
        if (command.startsWith('editpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 3) {
                const username = params[0];
                const field = params[1];
                const newValue = params.slice(2).join(' ');
                await this.pppoeCommands.handleEditPPPoE(remoteJid, username, field, newValue);
            }
            return;
        }
        
        if (command.startsWith('delpppoe ')) {
            const params = messageText.split(' ').slice(1);
            if (params.length >= 1) {
                const username = params[0];
                const reason = params.slice(1).join(' ') || null;
                await this.pppoeCommands.handleDeletePPPoE(remoteJid, username, reason);
            }
            return;
        }
        
        if (command.startsWith('pppoe ')) {
            const filter = messageText.split(' ').slice(1).join(' ');
            await this.pppoeCommands.handleListPPPoE(remoteJid, filter);
            return;
        }
        
        if (command === 'pppoe') {
            await this.pppoeCommands.handleListPPPoE(remoteJid);
            return;
        }
        
        if (command.startsWith('checkpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleCheckPPPoEStatus(remoteJid, username);
            return;
        }
        
        if (command.startsWith('restartpppoe ')) {
            const username = messageText.split(' ')[1];
            await this.pppoeCommands.handleRestartPPPoE(remoteJid, username);
            return;
        }
        
        if (command === 'help pppoe') {
            await this.pppoeCommands.handlePPPoEHelp(remoteJid);
            return;
        }
        
        // Help Commands
        if (command === 'admin') {
            await this.sendAdminHelp(remoteJid);
            return;
        }
        
        if (command === 'teknisi') {
            await this.sendTechnicianHelp(remoteJid);
            return;
        }
        
        if (command === 'menu' || command === 'help') {
            await this.sendAdminHelp(remoteJid);
            return;
        }
        
        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }
        
        if (command === 'info') {
            const systemInfoMessage = getSystemInfoMessage();
            await this.commands.sendMessage(remoteJid, systemInfoMessage);
            return;
        }
        
        // Unknown command
        await this.commands.sendMessage(remoteJid, 
            `❓ *PERINTAH TIDAK DIKENAL*\n\nPerintah "${command}" tidak dikenali.\n\nKetik *admin* untuk melihat menu lengkap.`
        );
    }

    // Handle customer commands
    async handleCustomerCommands(remoteJid, senderNumber, command, messageText) {
        // Customer-specific commands
        if (command === 'status') {
            await this.handleCustomerStatus(remoteJid, senderNumber);
            return;
        }
        
        if (command === 'menu' || command === 'help') {
            await this.sendCustomerHelp(remoteJid);
            return;
        }
        
        if (command === 'info') {
            await this.handleCustomerInfo(remoteJid, senderNumber);
            return;
        }
        
        // System Info Commands
        if (command === 'version') {
            const versionMessage = getVersionMessage();
            await this.commands.sendMessage(remoteJid, versionMessage);
            return;
        }
        
        // Unknown command for customer
        await this.commands.sendMessage(remoteJid, 
            `❓ *PERINTAH TIDAK DIKENAL*\n\nPerintah "${command}" tidak dikenali.\n\nKetik *menu* untuk melihat menu pelanggan.`
        );
    }

    // Send admin help message
    async sendAdminHelp(remoteJid) {
        const helpMessage = getAdminHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }
    
    // Send technician help message
    async sendTechnicianHelp(remoteJid) {
        const helpMessage = getTechnicianHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Send customer help message
    async sendCustomerHelp(remoteJid) {
        const helpMessage = getCustomerHelpMessage();
        await this.commands.sendMessage(remoteJid, helpMessage);
    }

    // Handle customer status request
    async handleCustomerStatus(remoteJid, senderNumber) {
        try {
            // Implementasi cek status pelanggan
            // ... existing code ...
            
            await this.commands.sendMessage(remoteJid, 
                `📱 *STATUS PELANGGAN*\n\nSedang mengecek status perangkat Anda...\nMohon tunggu sebentar.`
            );
            
        } catch (error) {
            logger.error('Error handling customer status', { 
                sender: senderNumber, 
                error: error.message 
            });
            
            await this.commands.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nTerjadi kesalahan saat mengecek status:\n${error.message}`
            );
        }
    }

    // Handle customer info request
    async handleCustomerInfo(remoteJid, senderNumber) {
        try {
            // Implementasi info layanan pelanggan
            // ... existing code ...
            
            await this.commands.sendMessage(remoteJid, 
                `📋 *INFO LAYANAN*\n\nSedang mengambil informasi layanan Anda...\nMohon tunggu sebentar.`
            );
            
        } catch (error) {
            logger.error('Error handling customer info', { 
                sender: senderNumber, 
                error: error.message 
            });
            
            await this.commands.sendMessage(remoteJid, 
                `❌ *ERROR*\n\nTerjadi kesalahan saat mengambil info:\n${error.message}`
            );
        }
    }

    // Handle welcome message for super admin
    async handleSuperAdminWelcome(sock) {
        if (!global.superAdminWelcomeSent && this.core.getSuperAdmin()) {
            try {
                const superAdminJid = this.core.createJID(this.core.getSuperAdmin());
                if (superAdminJid) {
                    await sock.sendMessage(superAdminJid, {
                        text: `${this.core.getSetting('company_header', 'ALIJAYA BOT MANAGEMENT ISP')}\n👋 *Selamat datang, Super Admin!*\n\nAplikasi WhatsApp Bot berhasil dijalankan.\n\nRekening Donasi Untuk Pembangunan Masjid\n# 4206 0101 2214 534 BRI an DKM BAITUR ROHMAN\n\n${this.core.getSetting('footer_info', 'Internet Tanpa Batas')}`
                    });
                    global.superAdminWelcomeSent = true;
                    logger.info('Pesan selamat datang terkirim ke super admin');
                }
            } catch (err) {
                logger.error('Gagal mengirim pesan selamat datang ke super admin:', err);
            }
        }
    }
}

module.exports = WhatsAppMessageHandlers;
