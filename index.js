const usb = require('usb');
const EventEmitter = require('events');

class tusb3410 extends EventEmitter {
  constructor(vendorId, productId, opts) {
    super();
    this.device = usb.findByIds(vendorId, productId);
    this.opts = opts;
    this.device.open(false); // don't auto-configure
    const self = this;

    console.log(JSON.stringify(this.device, null, 4));

    this.device.setConfiguration(2, () => {
      [self.iface] = this.device.interfaces;
      self.iface.claim();

      console.log(self.iface);
      self.inEndpoint = self.iface.endpoint(0x81);

      self.inEndpoint.startPoll();
      self.inEndpoint.on('data', (data) => {
        self.emit('data', data);
      });

      (async () => {
        try {
          // open port
          await this.controlTransferOut({
            requestType: 'vendor',
            recipient: 'device',
            request: 0x06,
            value: 0x89,
            index: 0x03,
          });

          // start port
          await this.controlTransferOut({
            requestType: 'vendor',
            recipient: 'device',
            request: 0x08,
            value: 0x00,
            index: 0x03,
          });

          const config = new Uint8Array([
            0x00, 0x30, // baud rate (19200 : 0x0030)
            0x60, 0x00, // flags ¯\_(ツ)_/¯
            0x03, // data bits (8 : 0x03)
            0x00, // parity (none : 0)
            0x00, // stop bits (none : 0)
            0x11, // xon (false : 0)
            0x13, // xoff (false : 0)
            0x00, // UART mode (RS-232 : 0)
          ]);

          await this.controlTransferOut({
            requestType: 'vendor',
            recipient: 'device',
            request: 0x05,
            value: 0x00,
            index: 0x03,
          }, config);
        } catch (err) {
          console.log('Error during TUSB3410 setup:', err);
        }

        self.emit('ready');
      })();
    });
  }

  static getRequestType(direction, requestType, recipient) {
    const TYPES = {
      standard: 0x00,
      class: 0x01,
      vendor: 0x02,
      reserved: 0x03,
    };

    const RECIPIENTS = {
      device: 0x00,
      interface: 0x01,
      endpoint: 0x02,
      other: 0x03,
    };

    const DIRECTION = {
      'host-to-device': 0x00,
      'device-to-host': 0x01,
    };

    return (DIRECTION[direction] << 7) || (TYPES[requestType] << 5) || RECIPIENTS[recipient];
  }

  controlTransfer(direction, transfer, dataOrLength) {
    return new Promise((resolve, reject) => {
      this.device.controlTransfer(tusb3410.getRequestType(direction, transfer.requestType, transfer.recipient), transfer.request, transfer.value, transfer.index, dataOrLength,
        (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        });
    });
  }

  controlTransferOut(transfer, data) {
    return new Promise((resolve, reject) => {
      this.controlTransfer('host-to-device', transfer, data != null ? Buffer.from(data) : Buffer.alloc(0)).then(() => resolve()).catch(() => reject());
    });
  }

  controlTransferIn(transfer, length) {
    return new Promise((resolve, reject) => {
      this.controlTansfer('device-to-host', transfer, length).then(() => resolve()).catch(() => reject());
    });
  }

  write(data, cb) {
    this.transferOut(1, data).then(() => {
      cb();
    }, err => cb(err, null));
  }

  transferIn(endpoint, length) {
    return new Promise((resolve, reject) => {
      this.iface.endpoint(endpoint | 0x80).transfer(length, (err, result) => {
        if (err) {
          console.log('transferIn Error:', err);
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  transferOut(endpoint, data) {
    return new Promise((resolve, reject) => {
      this.iface.endpoint(endpoint).transfer(data, (err, result) => {
        if (err) {
          console.log('transferOut Error:', err);
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  close(cb) {
    // close port
    this.controlTransferOut({
      requestType: 'vendor',
      recipient: 'device',
      request: 0x07,
      value: 0x00,
      index: 0x03,
    }).then(() => {
      this.iface.release(true, () => {
        this.removeAllListeners();
        this.device.close();
        return cb();
      });
    });
  }
}

module.exports = tusb3410;
