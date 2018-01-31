import React from 'react';
import ShowAsset from 'components/ShowAsset';
import ShowChannel from 'components/ShowChannel';
import lbryUri from 'utils/lbryUri';

const CHANNEL = 'CHANNEL';
const ASSET = 'ASSET';

class ShowPage extends React.Component {
  constructor (props) {
    super(props);
    this.state = {
      identifier    : null,
      claim         : null,
      isServeRequest: null,
    };
    this.parseUrlAndUpdateState = this.parseUrlAndUpdateState.bind(this);
    this.parseAndUpdateIdentifierAndClaim = this.parseAndUpdateIdentifierAndClaim.bind(this);
    this.parseAndUpdateClaimOnly = this.parseAndUpdateClaimOnly.bind(this);
  }
  componentDidMount () {
    console.log('ShowPage did mount');
    this.parseUrlAndUpdateState();
  }
  parseUrlAndUpdateState () {
    const identifier = this.props.match.params.identifier;
    const claim = this.props.match.params.claim;
    if (identifier) {
      return this.parseAndUpdateIdentifierAndClaim(identifier, claim);
    }
    this.parseAndUpdateClaimOnly(claim);
  }
  parseAndUpdateIdentifierAndClaim(identifier, claim) {
    // handle case of identifier and claim
    // this is a request for an asset
    // claim will be an asset claim
    // the identifier could be a channel or a claim id
    let isChannel, channelName, channelClaimId, claimId, claimName, isServeRequest;
    try {
      ({ isChannel, channelName, channelClaimId, claimId } = lbryUri.parseIdentifier(identifier));
      ({ claimName, isServeRequest } = lbryUri.parseName(claim));
    } catch (error) {
      return console.log('error:', error);
    }
    // set state
    return this.setState({
      identifier: {
        isChannel,
        channelName,
        channelClaimId,
        claimId,
      },
      claim: {
        claimName,
      },
      isServeRequest,
    });
  }
  parseAndUpdateClaimOnly (claim) {
    // handle case of just claim
    // this could be a request for an asset or a channel page
    // claim could be an asset claim or a channel claim
    let isChannel, channelName, channelClaimId;
    try {
      ({ isChannel, channelName, channelClaimId } = lbryUri.parseIdentifier(claim));
    } catch (error) {
      return console.log('error:', error);
    }
    if (isChannel) {
      return this.setState({
        claim: {
          isChannel,
          channelName,
          channelClaimId,
        },
      });
    }
    let claimName, isServeRequest;
    try {
      ({claimName, isServeRequest} = lbryUri.parseName(claim));
    } catch (error) {
      return console.log('error:', error);
    }
    this.setState({
      claim: {
        claimName,
      },
      isServeRequest,
    });
  }
  render () {
    console.log('rendering ShowPage');
    if (this.state.claim) {
      if (this.state.claim.isChannel) {
        return (
          <ShowChannel
            channelName={this.state.claim.channelName}
            channelClaimId={this.state.claim.channelClaimId}
          />
        );
      }
      return (
        <ShowAsset
          identifier={this.state.identifier} // this.state.url.identifier
          claim={this.state.claim} // this.state.url.claim
          isServeRequest={this.state.isServeRequest} // this.state.url.ending
        />
      );
    }
    return (
      <p>Loading...</p>
    );
  }
};

export default ShowPage;
