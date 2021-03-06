const logger = require('winston');
const multipart = require('connect-multiparty');
const { files, site } = require('../config/speechConfig.js');
const multipartMiddleware = multipart({uploadDir: files.uploadDirectory});
const db = require('../models');
const { checkClaimNameAvailability, checkChannelAvailability, publish } = require('../controllers/publishController.js');
const { getClaimList, resolveUri, getClaim } = require('../helpers/lbryApi.js');
const { createPublishParams, parsePublishApiRequestBody, parsePublishApiRequestFiles, parsePublishApiChannel, addGetResultsToFileData, createFileData } = require('../helpers/publishHelpers.js');
const errorHandlers = require('../helpers/errorHandlers.js');
const { sendGAAnonymousPublishTiming, sendGAChannelPublishTiming } = require('../helpers/googleAnalytics.js');
const { authenticateIfNoUserToken } = require('../auth/authentication.js');
const { getChannelData, getChannelClaims, getClaimId } = require('../controllers/serveController.js');

const NO_CHANNEL = 'NO_CHANNEL';
const NO_CLAIM = 'NO_CLAIM';

module.exports = (app) => {
  // route to check whether site has published to a channel
  app.get('/api/channel/availability/:name', ({ ip, originalUrl, params }, res) => {
    checkChannelAvailability(params.name)
      .then(result => {
        if (result === true) {
          res.status(200).json(true);
        } else {
          res.status(200).json(false);
        }
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to get a short channel id from long channel Id
  app.get('/api/channel/short-id/:longId/:name', ({ ip, originalUrl, params }, res) => {
    db.Certificate.getShortChannelIdFromLongChannelId(params.longId, params.name)
      .then(shortId => {
        res.status(200).json(shortId);
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  app.get('/api/channel/data/:channelName/:channelClaimId', ({ ip, originalUrl, body, params }, res) => {
    const channelName = params.channelName;
    let channelClaimId = params.channelClaimId;
    if (channelClaimId === 'none') channelClaimId = null;
    getChannelData(channelName, channelClaimId, 0)
      .then(data => {
        if (data === NO_CHANNEL) {
          return res.status(404).json({success: false, message: 'No matching channel was found'});
        }
        res.status(200).json({success: true, data});
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  app.get('/api/channel/claims/:channelName/:channelClaimId/:page', ({ ip, originalUrl, body, params }, res) => {
    const channelName = params.channelName;
    let channelClaimId = params.channelClaimId;
    if (channelClaimId === 'none') channelClaimId = null;
    const page = params.page;
    getChannelClaims(channelName, channelClaimId, page)
      .then(data => {
        if (data === NO_CHANNEL) {
          return res.status(404).json({success: false, message: 'No matching channel was found'});
        }
        res.status(200).json({success: true, data});
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to run a claim_list request on the daemon
  app.get('/api/claim/list/:name', ({ ip, originalUrl, params }, res) => {
    getClaimList(params.name)
      .then(claimsList => {
        res.status(200).json(claimsList);
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to get an asset
  app.get('/api/claim/get/:name/:claimId', ({ ip, originalUrl, params }, res) => {
    const name = params.name;
    const claimId = params.claimId;
    // resolve the claim
    db.Claim.resolveClaim(name, claimId)
      .then(resolveResult => {
        // make sure a claim actually exists at that uri
        if (!resolveResult) {
          throw new Error('No matching uri found in Claim table');
        }
        let fileData = createFileData(resolveResult);
        // get the claim
        return Promise.all([fileData, getClaim(`${name}#${claimId}`)]);
      })
      .then(([ fileData, getResult ]) => {
        fileData = addGetResultsToFileData(fileData, getResult);
        return Promise.all([db.upsert(db.File, fileData, {name, claimId}, 'File'), getResult]);
      })
      .then(([ fileRecord, {message, completed} ]) => {
        res.status(200).json({ success: true, message, completed });
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to check whether this site published to a claim
  app.get('/api/claim/availability/:name', ({ ip, originalUrl, params }, res) => {
    checkClaimNameAvailability(params.name)
      .then(result => {
        if (result === true) {
          res.status(200).json(true);
        } else {
          res.status(200).json(false);
        }
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to run a resolve request on the daemon
  app.get('/api/claim/resolve/:name/:claimId', ({ headers, ip, originalUrl, params }, res) => {
    resolveUri(`${params.name}#${params.claimId}`)
      .then(resolvedUri => {
        res.status(200).json(resolvedUri);
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to run a publish request on the daemon
  app.post('/api/claim/publish', multipartMiddleware, ({ body, files, headers, ip, originalUrl, user }, res) => {
    logger.debug('api/claim-publish body:', body);
    logger.debug('api/claim-publish files:', files);
    // define variables
    let  name, fileName, filePath, fileType, nsfw, license, title, description, thumbnail, channelName, channelPassword;
    // record the start time of the request
    const publishStartTime = Date.now();
    // validate the body and files of the request
    try {
      // validateApiPublishRequest(body, files);
      ({name, nsfw, license, title, description, thumbnail} = parsePublishApiRequestBody(body));
      ({fileName, filePath, fileType} = parsePublishApiRequestFiles(files));
      ({channelName, channelPassword} = parsePublishApiChannel(body, user));
    } catch (error) {
      return res.status(400).json({success: false, message: error.message});
    }
    // check channel authorization
    authenticateIfNoUserToken(channelName, channelPassword, user)
      .then(authenticated => {
        if (!authenticated) {
          throw new Error('Authentication failed, you do not have access to that channel');
        }
        // make sure the claim name is available
        return checkClaimNameAvailability(name);
      })
      .then(result => {
        if (!result) {
          throw new Error('That name is already claimed by another user.');
        }
        // create publish parameters object
        return createPublishParams(filePath, name, title, description, license, nsfw, thumbnail, channelName);
      })
      .then(publishParams => {
        // publish the asset
        return publish(publishParams, fileName, fileType);
      })
      .then(result => {
        res.status(200).json({
          success: true,
          message: 'publish completed successfully',
          data   : {
            name,
            claimId: result.claim_id,
            url    : `${site.host}/${result.claim_id}/${name}`,
            lbryTx : result,
          },
        });
        // record the publish end time and send to google analytics
        const publishEndTime = Date.now();
        if (channelName) {
          sendGAChannelPublishTiming(headers, ip, originalUrl, publishStartTime, publishEndTime);
        } else {
          sendGAAnonymousPublishTiming(headers, ip, originalUrl, publishStartTime, publishEndTime);
        }
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to get a short claim id from long claim Id
  app.get('/api/claim/short-id/:longId/:name', ({ ip, originalUrl, body, params }, res) => {
    db.Claim.getShortClaimIdFromLongClaimId(params.longId, params.name)
      .then(shortId => {
        res.status(200).json({success: true, data: shortId});
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  app.post('/api/claim/long-id', ({ ip, originalUrl, body, params }, res) => {
    logger.debug('body:', body);
    const channelName = body.channelName;
    const channelClaimId = body.channelClaimId;
    const claimName = body.claimName;
    const claimId = body.claimId;
    getClaimId(channelName, channelClaimId, claimName, claimId)
      .then(result => {
        if (result === NO_CHANNEL) {
          return res.status(404).json({success: false, message: 'No matching channel could be found'});
        }
        if (result === NO_CLAIM) {
          return res.status(404).json({success: false, message: 'No matching claim id could be found'});
        }
        res.status(200).json({success: true, data: result});
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  app.get('/api/claim/data/:claimName/:claimId', ({ ip, originalUrl, body, params }, res) => {
    const claimName = params.claimName;
    let claimId = params.claimId;
    if (claimId === 'none') claimId = null;
    db.Claim.resolveClaim(claimName, claimId)
      .then(claimInfo => {
        if (!claimInfo) {
          return res.status(404).json({success: false, message: 'No claim could be found'});
        }
        res.status(200).json({success: true, data: claimInfo});
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
  // route to see if asset is available locally
  app.get('/api/file/availability/:name/:claimId', ({ ip, originalUrl, params }, res) => {
    const name = params.name;
    const claimId = params.claimId;
    db.File.findOne({where: {name, claimId}})
      .then(result => {
        if (result) {
          return res.status(200).json({success: true, data: true});
        }
        res.status(200).json({success: true, data: false});
      })
      .catch(error => {
        errorHandlers.handleErrorResponse(originalUrl, ip, error, res);
      });
  });
};
